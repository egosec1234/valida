// Supabase Edge Function: analyze
// Inserts a `submissions` row immediately (status: "processing") and returns
// right away, then runs the Claude research + scoring call in the background
// via EdgeRuntime.waitUntil. This avoids the request idle-timeout (150s) that
// a synchronous multi-step research call could hit. The frontend polls the
// submission row until status becomes "complete" or "failed".
//
// Deploy: supabase functions deploy analyze
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { describeError, markFailed, requestStructuredReport, requestWithRetry } from "../_shared/claudeReport.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const IDEA_TEXT_MAX_LENGTH = 500;
const NICHE_MAX_LENGTH = 100;
// Matches STALE_AFTER_MS in src/pages/ResultPage.tsx - a "processing" row
// older than this almost certainly died mid-run rather than being genuinely
// in progress.
const STALE_PROCESSING_MS = 3 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "Overall market viability score from 0-100.",
    },
    summary: {
      type: "string",
      description:
        "A short, honest, non-sycophantic summary of market viability (3-5 sentences).",
    },
    risks: {
      type: "array",
      description:
        "Key risks or red flags for this idea, each with a concrete explanation. At most 4 items, ordered from most to least critical - the free preview shows only the first one.",
      items: {
        type: "object",
        properties: {
          risk: {
            type: "string",
            description: "The risk itself, stated plainly in one short phrase.",
          },
          explanation: {
            type: "string",
            description:
              "One to two sentences of concrete context on why this is a real risk for this specific idea, grounded in what you found, not a restatement of the risk.",
          },
        },
        required: ["risk", "explanation"],
        additionalProperties: false,
      },
    },
    competitors: {
      type: "array",
      description:
        "Real competitors or close substitutes found via research. At most 4 items, ordered from the biggest threat to the smallest - the free preview shows only the first one in full.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string", description: "What they do, in plain terms." },
          pricing: {
            type: "string",
            description:
              "Rough pricing if you actually found it (e.g. '$29/mo' or 'Free tier, $99/mo Pro'). Omit this field entirely if you didn't find real pricing. Never guess or estimate one.",
          },
          threat: {
            type: "string",
            description:
              "One to two sentences on specifically what makes this competitor a threat to this idea: the real mechanism (scale, funding, distribution, brand, existing customer base), not just 'they also do this'.",
          },
          differentiation: {
            type: "string",
            description:
              "One sentence on how this competitor differs from the other competitors listed in this same report.",
          },
          howToCompete: {
            type: "string",
            description:
              "One to two sentences on a specific, concrete angle this founder could use to win against this exact competitor: a gap in what they offer, a segment they ignore, a pricing angle, or something else grounded in what you found. Never generic advice like 'focus on better UX'.",
          },
          url: { type: "string" },
        },
        required: ["name", "description", "threat", "differentiation", "howToCompete"],
        additionalProperties: false,
      },
    },
    basicRecommendation: {
      type: "string",
      description:
        "One sentence: proceed, don't, or proceed only if a specific condition changes. This is shown on its own in the free preview, before the full reasoning, so it must stand alone without the rest of the report.",
    },
    recommendation: {
      type: "string",
      description:
        "2-3 full sentences giving a direct recommendation on whether/how to proceed, naming the specific condition or change that would make this idea worth pursuing (or why it isn't worth pursuing at all). Never a single word or sentence fragment.",
    },
    pivots: {
      type: "array",
      description:
        "Real alternate directions for this idea, if your research turned up one genuinely worth considering. At most 3 items. Leave this an empty array if the idea is fine as-is or no real pivot stands out - never invent one just to fill the field.",
      items: {
        type: "object",
        properties: {
          pivot: {
            type: "string",
            description: "The alternate direction itself, stated plainly in one short phrase.",
          },
          reason: {
            type: "string",
            description:
              "One to two sentences on why this pivot is worth considering, grounded in what you found.",
          },
        },
        required: ["pivot", "reason"],
        additionalProperties: false,
      },
    },
    sources: {
      type: "array",
      description:
        "The specific sources you actually used - articles, official pricing pages, funding announcements, industry reports. At most 5 items, real URLs only. Leave this an empty array rather than inventing one if nothing is worth citing directly.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "A specific, identifying label for this source (e.g. 'TechCrunch: Acme raises $10M Series A'), not just the publication name.",
          },
          url: { type: "string" },
        },
        required: ["title", "url"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "score",
    "summary",
    "risks",
    "competitors",
    "basicRecommendation",
    "recommendation",
    "pivots",
    "sources",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are Valida, an honest, non-sycophantic startup advisor. \
Founders come to you for blunt, well-researched feedback on their business idea, \
not encouragement. Use web search to find real competitors, pricing, market size \
signals, and recent news relevant to the idea and niche. Ground every claim in what \
you actually find; if the market looks crowded, saturated, or weak, say so plainly. \
Do not soften bad news.

For each competitor, go beyond a one-line description: give rough pricing if you \
actually found it (never guess or invent a number; leave it out if you didn't find \
it), explain specifically what makes them a threat to this idea (their scale, \
funding, distribution, or existing customer base, not just "they also do this"), \
say how they differ from the other competitors in your list, and give one concrete \
way this founder could actually win against that specific competitor - a gap in \
what they offer, a segment they ignore, a pricing angle, or something else grounded \
in what you found, never generic advice. For each risk, add a sentence of concrete \
explanation grounded in your research rather than restating the risk.

Give a one-sentence basic recommendation that stands on its own: proceed, don't, \
or proceed only if a specific condition changes. Then give the fuller \
recommendation with your full reasoning. If your research points to a genuinely \
different direction this idea should consider instead, list it as a pivot with a \
short reason; if the idea is sound as-is or no real pivot stands out, leave the \
pivot list empty rather than inventing one.

When a claim in your summary or recommendation comes from something specific you \
found (a competitor's funding round, a pricing change, a market size figure, a \
notable news item), name where it came from so a founder can verify it instead of \
taking your word for it. List the specific sources you actually used, with their \
real URLs, in the sources field - never fabricate one, and leave it empty rather \
than citing something you didn't actually check.

Write in plain, direct sentences, the way you'd actually talk to a founder. Skip \
hedge words, filler transitions, and stock phrases. Don't force findings into three \
matching bullet points if the real number is two or four. Name real companies, \
numbers, and mechanisms instead of vague description. Return at most 4 risks and \
at most 4 competitors - pick the ones that matter most rather than listing every \
one you find, and never cut a sentence short to fit more in. List risks in order \
from most to least critical and competitors in order from biggest threat to \
smallest - the first one of each is the one that matters most. Return your \
findings in the required structured format only.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const { idea_text, niche } = await req.json();
    if (!idea_text || typeof idea_text !== "string") {
      return json({ error: "idea_text is required" }, 400);
    }
    if (idea_text.length > IDEA_TEXT_MAX_LENGTH) {
      return json(
        { error: `Business idea must be ${IDEA_TEXT_MAX_LENGTH} characters or fewer.` },
        400,
      );
    }
    if (niche !== undefined && niche !== null && typeof niche !== "string") {
      return json({ error: "niche must be a string" }, 400);
    }
    if (typeof niche === "string" && niche.length > NICHE_MAX_LENGTH) {
      return json(
        { error: `Niche must be ${NICHE_MAX_LENGTH} characters or fewer.` },
        400,
      );
    }

    // Client scoped to the requesting user's JWT so the initial insert
    // respects RLS (auth.uid() = user_id) without needing the service-role
    // key. Submissions RLS only grants select/insert to authenticated users
    // (see 20260722143144_restrict_submissions_update.sql) - the background
    // write-back below uses a separate service-role client instead.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return json({ error: "Server misconfigured: missing ANTHROPIC_API_KEY" }, 500);
    }

    // Service-role client: used both to self-heal a stuck submission below
    // and for the background write-back after this function returns. The
    // row's owner only has select/insert access on submissions (see
    // 20260722143144_restrict_submissions_update.sql), so neither a stuck
    // row's recovery nor score/report/status can be set from a user-scoped
    // client.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Free tier: one active (non-failed) submission per account, ever.
    // Admin accounts (app_metadata.is_admin, only settable via the
    // service-role Admin API) are exempt. This check is a fast path for a
    // clear error message; the database's partial unique index is the real
    // enforcement and closes the race if two requests land at once.
    const isAdmin = user.app_metadata?.is_admin === true;
    if (!isAdmin) {
      const { data: existing } = await supabase
        .from("submissions")
        .select("id, status, created_at")
        .neq("status", "failed")
        .limit(1)
        .maybeSingle();

      if (existing) {
        // A "processing" row this old almost certainly means the background
        // worker died mid-run without ever reaching its own catch block.
        // Without this, an account with a genuinely stuck submission could
        // never submit again - ResultPage.tsx's "Try again" link routes
        // here, but this same check would otherwise still see the stuck row
        // and block a fresh one with no way out.
        const isStaleProcessing =
          existing.status === "processing" &&
          Date.now() - new Date(existing.created_at).getTime() > STALE_PROCESSING_MS;

        if (isStaleProcessing) {
          await markFailed(
            supabaseAdmin,
            "submissions",
            existing.id,
            "This took too long and was stopped automatically. Please try again.",
          );
        } else {
          return json(
            {
              error: "You've already used your free score.",
              existingSubmissionId: existing.id,
            },
            403,
          );
        }
      }
    }

    // Create the row up front and respond immediately - the actual research
    // call runs after this function returns, via EdgeRuntime.waitUntil.
    const { data: inserted, error: insertError } = await supabase
      .from("submissions")
      .insert({
        user_id: user.id,
        idea_text,
        niche: niche || null,
        status: "processing",
      })
      .select()
      .single();

    if (insertError) {
      // 23505 = unique_violation - a race between two near-simultaneous
      // requests from the same account both passed the check above. Point
      // the loser at whichever submission actually won instead of a raw
      // insert error.
      if (insertError.code === "23505") {
        const { data: existing } = await supabase
          .from("submissions")
          .select("id")
          .neq("status", "failed")
          .limit(1)
          .maybeSingle();
        return json(
          {
            error: "You've already used your free score.",
            existingSubmissionId: existing?.id,
          },
          403,
        );
      }
      return json({ error: insertError.message }, 500);
    }

    EdgeRuntime.waitUntil(
      runAnalysis(supabaseAdmin, anthropicApiKey, inserted.id, idea_text, niche),
    );

    return json({ submission: inserted });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

type Report = {
  score: number;
  summary: string;
  risks: unknown[];
  competitors: unknown[];
  basicRecommendation: string;
  recommendation: string;
  pivots: unknown[];
};

// Rarely, the model returns a bare-minimum schema-valid stub instead of a
// real report (e.g. summary "placeholder", score 0, empty risks/competitors)
// - a degenerate response, not a thrown error, so it would otherwise get
// saved as a successful "complete" result. Treat it as a failed attempt.
function isDegenerateReport(report: Report): boolean {
  if (!report.summary || report.summary.trim().toLowerCase() === "placeholder") {
    return true;
  }
  if (!report.basicRecommendation) {
    return true;
  }
  return (report.risks?.length ?? 0) === 0 && (report.competitors?.length ?? 0) === 0;
}

async function runAnalysis(
  supabase: SupabaseClient,
  anthropicApiKey: string,
  submissionId: string,
  ideaText: string,
  niche: string | undefined,
) {
  try {
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const userPrompt = `Business idea: ${ideaText}\nNiche/category: ${
      niche || "(not specified)"
    }\n\nResearch this idea's market and competitors, then score it.`;

    // This report is now the paid product, so it runs deeper than the
    // original default: more search budget (4 instead of 2) so there's more
    // real material to draw on and cite, and named-source citations in the
    // prompt above so the report reads as thorough through specific,
    // checkable detail rather than through raw effort. effort stays at
    // "medium" - "high" effort at this search budget regularly ran past
    // even a 130s timeout. Even at "medium", real runs have been observed
    // to occasionally exceed 90s, so timeoutMs is set close to the free
    // Supabase plan's 150s wall-clock ceiling as this can safely go (a
    // single attempt, so there's no second call stacking on top of it). If
    // this still times out often in practice, the two real remaining
    // levers are the Supabase Pro plan's 400s ceiling, or fewer searches.
    const report = await requestWithRetry<Report>(
      () =>
        requestStructuredReport<Report>(anthropic, {
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          schema: REPORT_SCHEMA,
          maxTokens: 13000,
          webSearchMaxUses: 4,
          effort: "medium",
          timeoutMs: 125000,
        }),
      isDegenerateReport,
      1,
    );

    const { error: updateError } = await supabase
      .from("submissions")
      .update({ score: report.score, report, status: "complete" })
      .eq("id", submissionId);

    if (updateError) {
      console.error("Failed to save completed report:", updateError);
      await markFailed(supabase, "submissions", submissionId, updateError.message);
    }
  } catch (err) {
    console.error(err);
    await markFailed(supabase, "submissions", submissionId, describeError(err));
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
