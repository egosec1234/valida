// Supabase Edge Function: weekly-monitor
// Triggered weekly by pg_cron (see migration 20260721120000_create_niche_updates.sql)
// via net.http_post with a shared secret header - not a user-facing endpoint.
// For every tracked_niches row with status='active', researches what's
// changed since the last check and writes a niche_updates row. Sends a
// digest email only when something meaningful actually changed.
//
// Deploy: supabase functions deploy weekly-monitor
// Secrets: supabase secrets set CRON_SECRET=... RESEND_API_KEY=re_...
// (ANTHROPIC_API_KEY is already set for the analyze function.)

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { Resend } from "npm:resend@6.17.2";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { describeError, markFailed, requestStructuredReport, requestWithRetry } from "../_shared/claudeReport.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://valida-validaai.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Competitor = { name: string; description: string; pricing?: string };
type OriginalReport = { summary: string; competitors: Competitor[] };

type Digest = {
  has_meaningful_changes: boolean;
  summary: string;
  notable_changes: { change: string; detail: string }[];
};

const DIGEST_SCHEMA = {
  type: "object",
  properties: {
    has_meaningful_changes: {
      type: "boolean",
      description:
        "True only if something concrete and worth a founder's attention changed since the last check. False for a quiet week - don't manufacture minor or speculative changes just to have something to report.",
    },
    summary: {
      type: "string",
      description:
        "2-4 sentences written directly to the founder, on what changed (or that nothing significant did) since the last check.",
    },
    notable_changes: {
      type: "array",
      description:
        "Specific changes found. Empty array if has_meaningful_changes is false. At most 4 items.",
      items: {
        type: "object",
        properties: {
          change: {
            type: "string",
            description: "One short phrase naming the change (e.g. 'New competitor launched').",
          },
          detail: {
            type: "string",
            description: "One to two sentences of concrete detail grounded in what you found.",
          },
        },
        required: ["change", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["has_meaningful_changes", "summary", "notable_changes"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are Valida's weekly niche-monitoring analyst. You previously \
researched a founder's market and are now checking what has changed since the last check. \
Use web search to look for new competitors, notable pricing changes, funding news, or \
relevant community discussion (Reddit, Hacker News, industry press) in this niche since the \
last snapshot. Only report genuinely new or changed information - do not repeat what was \
already known, and do not invent minor or speculative changes just to fill the report. If \
nothing meaningful changed, say so plainly, set has_meaningful_changes to false, and return \
an empty notable_changes array. Write in plain, direct sentences. Return your findings in \
the required structured format only.`;

// Also catches the model reporting that search itself failed (a coherent
// but useless response - retrying gives it another shot at a real check
// instead of silently recording an inconclusive week as "no changes").
// Anchored to phrases the model actually uses to describe its own tool
// failing, rather than a loose "search ... failed" proximity match, which
// could false-positive on a real finding like "a search startup failed to
// raise its next round".
const SEARCH_FAILURE_PATTERN =
  /\b(search (tool|results?)|the tool)\b.{0,20}\b(unavailable|not available|failed|inconclusive)\b|\b(unable|not able|couldn'?t|wasn'?t able) to (retrieve|access|pull|perform|run).{0,15}\bsearch/i;

function isDegenerateDigest(digest: Digest): boolean {
  if (!digest.summary || digest.summary.trim().toLowerCase() === "placeholder") {
    return true;
  }
  return SEARCH_FAILURE_PATTERN.test(digest.summary);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!expectedSecret || cronSecret !== expectedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) {
    return json({ error: "Server misconfigured: missing ANTHROPIC_API_KEY" }, 500);
  }

  // Service-role client: this job runs across every user's tracked niches,
  // not on behalf of a single authenticated caller.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: activeNiches, error: queryError } = await supabase
    .from("tracked_niches")
    .select("id, niche, user_id, submissions(idea_text, niche, report)")
    .eq("status", "active");

  if (queryError) {
    return json({ error: queryError.message }, 500);
  }

  const niches = activeNiches ?? [];
  EdgeRuntime.waitUntil(processAllNiches(supabase, anthropicApiKey, niches));

  return json({ queued: niches.length });
});

async function processAllNiches(
  supabase: SupabaseClient,
  anthropicApiKey: string,
  // deno-lint-ignore no-explicit-any
  niches: any[],
) {
  const results = await Promise.allSettled(
    niches.map((niche) => processOneNiche(supabase, anthropicApiKey, niche)),
  );
  // processOneNiche catches its own errors (via markFailed) and resolves
  // normally rather than rejecting, so a rejected-promise count alone would
  // always read zero even when niches genuinely failed - check each
  // resolved value's own ok flag too.
  const failureCount = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
  if (failureCount > 0) {
    console.error(`${failureCount}/${niches.length} niche updates failed`);
  }
}

async function processOneNiche(
  supabase: SupabaseClient,
  anthropicApiKey: string,
  // deno-lint-ignore no-explicit-any
  trackedNiche: any,
): Promise<{ ok: boolean }> {
  const trackedNicheId = trackedNiche.id as string;
  const nicheLabel = (trackedNiche.niche as string | null) ?? "(not specified)";
  const originalSubmission = trackedNiche.submissions as
    | { idea_text: string; niche: string | null; report: OriginalReport | null }
    | null;

  // The lookup only ever needs the most recent *complete* row, and the row
  // being inserted here starts at "processing" - it can never match that
  // filter, so the two queries don't actually depend on each other and can
  // run concurrently instead of one blocking the other.
  const [{ data: inserted, error: insertError }, { data: lastUpdate }] = await Promise.all([
    supabase
      .from("niche_updates")
      .insert({ tracked_niche_id: trackedNicheId, status: "processing" })
      .select()
      .single(),
    supabase
      .from("niche_updates")
      .select("summary, notable_changes, created_at")
      .eq("tracked_niche_id", trackedNicheId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (insertError || !inserted) {
    console.error(`Failed to create niche_updates row for ${trackedNicheId}:`, insertError);
    return { ok: false };
  }

  try {
    const baseline = lastUpdate
      ? `Last check (${lastUpdate.created_at}): ${lastUpdate.summary}\nChanges noted then: ${
        JSON.stringify(lastUpdate.notable_changes)
      }`
      : originalSubmission?.report
      ? `Initial research: ${originalSubmission.report.summary}\nCompetitors known at the time: ${
        JSON.stringify(originalSubmission.report.competitors)
      }`
      : "No prior snapshot available - this is the first check for this niche.";

    const userPrompt = `Business idea: ${originalSubmission?.idea_text ?? "(unknown)"}\n` +
      `Niche/category: ${nicheLabel}\n\n${baseline}\n\n` +
      `Research what's changed in this niche since the last check above.`;

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const digest = await requestWithRetry<Digest>(
      () =>
        requestStructuredReport<Digest>(anthropic, {
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          schema: DIGEST_SCHEMA,
          maxTokens: 4000,
          webSearchMaxUses: 2,
          effort: "medium",
          timeoutMs: 45000,
        }),
      isDegenerateDigest,
    );

    const { error: updateError } = await supabase
      .from("niche_updates")
      .update({
        status: "complete",
        summary: digest.summary,
        notable_changes: digest.notable_changes,
        has_meaningful_changes: digest.has_meaningful_changes,
      })
      .eq("id", inserted.id);

    if (updateError) {
      console.error(`Failed to save niche update ${inserted.id}:`, updateError);
      await markFailed(supabase, "niche_updates", inserted.id, updateError.message);
      return { ok: false };
    }

    if (digest.has_meaningful_changes) {
      await sendDigestEmail(supabase, trackedNiche.user_id, trackedNicheId, inserted.id, nicheLabel, digest);
    }
    return { ok: true };
  } catch (err) {
    console.error(`Niche update ${inserted.id} failed:`, err);
    await markFailed(supabase, "niche_updates", inserted.id, describeError(err));
    return { ok: false };
  }
}

async function sendDigestEmail(
  supabase: SupabaseClient,
  userId: string,
  trackedNicheId: string,
  nicheUpdateId: string,
  nicheLabel: string,
  digest: Digest,
) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("Skipping email: RESEND_API_KEY not configured");
    return;
  }

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError || !userData?.user?.email) {
    console.error(`Could not look up email for user ${userId}:`, userError);
    return;
  }

  const changesHtml = digest.notable_changes
    .map((c) => `<li><strong>${escapeHtml(c.change)}</strong>: ${escapeHtml(c.detail)}</li>`)
    .join("");
  const link = `${SITE_URL}/track/${trackedNicheId}`;
  // nicheLabel comes from the user-supplied niche field (length-capped, but
  // not filtered for control characters) - strip anything that could act as
  // a line break in a header before it lands in the email subject.
  const safeNicheLabel = nicheLabel.replace(/[\r\n]+/g, " ").trim();

  const resend = new Resend(resendApiKey);
  const { error } = await resend.emails.send(
    {
      from: "Valida <onboarding@resend.dev>",
      to: [userData.user.email],
      subject: `Your niche "${safeNicheLabel}" changed this week`,
      html: `<p>${escapeHtml(digest.summary)}</p>` +
        (changesHtml ? `<ul>${changesHtml}</ul>` : "") +
        `<p><a href="${link}">See the full update</a></p>`,
    },
    { idempotencyKey: `niche-update/${nicheUpdateId}` },
  );

  if (error) {
    console.error(`Failed to send digest email for ${nicheUpdateId}:`, error);
    return;
  }

  const { error: markSentError } = await supabase
    .from("niche_updates")
    .update({ email_sent: true })
    .eq("id", nicheUpdateId);
  if (markSentError) {
    console.error(`Sent digest email for ${nicheUpdateId} but failed to record email_sent:`, markSentError);
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
