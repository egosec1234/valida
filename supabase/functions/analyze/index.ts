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

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const MODEL_ID = Deno.env.get("ANTHROPIC_MODEL_ID") ?? "claude-sonnet-5";

const IDEA_TEXT_MAX_LENGTH = 500;
const NICHE_MAX_LENGTH = 100;

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
      description: "Key risks or red flags for this idea, each with a concrete explanation. At most 4 items.",
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
      description: "Real competitors or close substitutes found via research. At most 4 items.",
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
          url: { type: "string" },
        },
        required: ["name", "description", "threat", "differentiation"],
        additionalProperties: false,
      },
    },
    recommendation: {
      type: "string",
      description:
        "2-3 full sentences giving a direct recommendation on whether/how to proceed, naming the specific condition or change that would make this idea worth pursuing (or why it isn't worth pursuing at all). Never a single word or sentence fragment.",
    },
  },
  required: ["score", "summary", "risks", "competitors", "recommendation"],
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
and say how they differ from the other competitors in your list. For each risk, add \
a sentence of concrete explanation grounded in your research rather than restating \
the risk.

Write in plain, direct sentences, the way you'd actually talk to a founder. Skip \
hedge words, filler transitions, and stock phrases. Don't force findings into three \
matching bullet points if the real number is two or four. Name real companies, \
numbers, and mechanisms instead of vague description. Return at most 4 risks and \
at most 4 competitors - pick the ones that matter most rather than listing every \
one you find, and never cut a sentence short to fit more in. Return your findings \
in the required structured format only.`;

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

    // Client scoped to the requesting user's JWT so inserts/updates respect
    // RLS (auth.uid() = user_id) without needing the service-role key.
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

    // Free tier: one active (non-failed) submission per account, ever.
    // Admin accounts (app_metadata.is_admin, only settable via the
    // service-role Admin API) are exempt. This check is a fast path for a
    // clear error message; the database's partial unique index is the real
    // enforcement and closes the race if two requests land at once.
    const isAdmin = user.app_metadata?.is_admin === true;
    if (!isAdmin) {
      const { data: existing } = await supabase
        .from("submissions")
        .select("id, status")
        .neq("status", "failed")
        .limit(1)
        .maybeSingle();

      if (existing) {
        return json(
          {
            error: "You've already used your free score.",
            existingSubmissionId: existing.id,
          },
          403,
        );
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
      runAnalysis(supabase, anthropicApiKey, inserted.id, idea_text, niche),
    );

    return json({ submission: inserted });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

const MAX_ATTEMPTS = 2;

// Rarely, the model returns a bare-minimum schema-valid stub instead of a
// real report (e.g. summary "placeholder", score 0, empty risks/competitors)
// - a degenerate response, not a thrown error, so it would otherwise get
// saved as a successful "complete" result. Treat it as a failed attempt.
function isDegenerateReport(report: {
  summary?: string;
  risks?: unknown[];
  competitors?: unknown[];
}): boolean {
  if (!report.summary || report.summary.trim().toLowerCase() === "placeholder") {
    return true;
  }
  return (report.risks?.length ?? 0) === 0 && (report.competitors?.length ?? 0) === 0;
}

async function requestReport(anthropic: Anthropic, ideaText: string, niche: string | undefined) {
  const userPrompt = `Business idea: ${ideaText}\nNiche/category: ${
    niche || "(not specified)"
  }\n\nResearch this idea's market and competitors, then score it.`;

  const message = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 10000,
    thinking: { type: "disabled" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: REPORT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 2 },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  if (message.stop_reason === "refusal") {
    throw new Error("The model declined to process this request.");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No structured report returned by the model");
  }

  return JSON.parse(textBlock.text);
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

    let report: Awaited<ReturnType<typeof requestReport>> | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const candidate = await requestReport(anthropic, ideaText, niche);
        if (!isDegenerateReport(candidate)) {
          report = candidate;
          break;
        }
        lastError = new Error("Model returned an empty/placeholder report");
        console.error(`Attempt ${attempt}: degenerate report, retrying`);
      } catch (err) {
        lastError = err;
        console.error(`Attempt ${attempt} failed:`, err);
      }
    }

    if (!report) {
      await markFailed(
        supabase,
        submissionId,
        lastError instanceof Error ? lastError.message : "Failed to generate a report",
      );
      return;
    }

    const { error: updateError } = await supabase
      .from("submissions")
      .update({ score: report.score, report, status: "complete" })
      .eq("id", submissionId);

    if (updateError) {
      console.error("Failed to save completed report:", updateError);
    }
  } catch (err) {
    console.error(err);
    try {
      await markFailed(
        supabase,
        submissionId,
        err instanceof Error ? err.message : "Unknown error",
      );
    } catch (markFailedErr) {
      console.error("Failed to mark submission as failed:", markFailedErr);
    }
  }
}

async function markFailed(
  supabase: SupabaseClient,
  submissionId: string,
  errorMessage: string,
) {
  const { error } = await supabase
    .from("submissions")
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", submissionId);
  if (error) console.error("Failed to mark submission as failed:", error);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
