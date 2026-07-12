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
      description: "Key risks or red flags for this idea.",
      items: { type: "string" },
    },
    competitors: {
      type: "array",
      description: "Real competitors or close substitutes found via research.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          url: { type: "string" },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
    },
    recommendation: {
      type: "string",
      description: "A brief, direct recommendation on whether/how to proceed.",
    },
  },
  required: ["score", "summary", "risks", "competitors", "recommendation"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are Valida, an honest, non-sycophantic startup advisor. \
Founders come to you for blunt, well-researched feedback on their business idea \
- not encouragement. Use web search to find real competitors, market size signals, \
and recent news relevant to the idea and niche. Ground every claim in what you \
actually find; if the market looks crowded, saturated, or weak, say so plainly. \
Do not soften bad news. Return your findings in the required structured format only.`;

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

    const message = await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: 4096,
      thinking: { type: "disabled" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: REPORT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 1 },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    if (message.stop_reason === "refusal") {
      await markFailed(supabase, submissionId, "The model declined to process this request.");
      return;
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      await markFailed(supabase, submissionId, "No structured report returned by the model");
      return;
    }

    const report = JSON.parse(textBlock.text);

    const { error: updateError } = await supabase
      .from("submissions")
      .update({ score: report.score, report, status: "complete" })
      .eq("id", submissionId);

    if (updateError) {
      console.error("Failed to save completed report:", updateError);
    }
  } catch (err) {
    console.error(err);
    await markFailed(
      supabase,
      submissionId,
      err instanceof Error ? err.message : "Unknown error",
    );
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
