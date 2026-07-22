// Shared helper for calling Claude with a JSON-schema structured output and
// web search, used by both the initial-score (analyze) and weekly-digest
// (weekly-monitor) Edge Functions. Centralizes the retry-on-degenerate-
// response behavior so both call sites get the same reliability handling.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const MODEL_ID = Deno.env.get("ANTHROPIC_MODEL_ID") ?? "claude-sonnet-5";

export type StructuredRequestOptions = {
  systemPrompt: string;
  userPrompt: string;
  schema: object;
  maxTokens?: number;
  webSearchMaxUses?: number;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
};

// The Anthropic SDK defaults to a 10-minute request timeout with 2 automatic
// retries on top - fine on its own, but stacked with requestWithRetry's own
// retry loop below, a hung request could run far longer than the Edge
// Function's wall-clock limit (150s free / 400s paid). When that limit
// hits, Supabase kills the worker before our catch block ever runs, leaving
// the row stuck at "processing" forever instead of marked failed. Capping
// the per-attempt timeout here (and disabling the SDK's own retry, since
// requestWithRetry already provides one) keeps the worst case bounded and
// well inside the platform limit.
const DEFAULT_TIMEOUT_MS = 45_000;

export async function requestStructuredReport<T>(
  anthropic: Anthropic,
  options: StructuredRequestOptions,
): Promise<T> {
  const {
    systemPrompt,
    userPrompt,
    schema,
    maxTokens = 10000,
    webSearchMaxUses = 2,
    effort = "medium",
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const message = await anthropic.messages.create(
    {
      model: MODEL_ID,
      max_tokens: maxTokens,
      thinking: { type: "disabled" },
      output_config: {
        effort,
        format: { type: "json_schema", schema },
      },
      system: systemPrompt,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: webSearchMaxUses },
      ],
      messages: [{ role: "user", content: userPrompt }],
    },
    { timeout: timeoutMs, maxRetries: 0 },
  );

  // Logged for cost tracking - visible via `supabase functions logs`.
  console.log(
    "claude usage:",
    JSON.stringify({
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      web_search_requests: message.usage.server_tool_use?.web_search_requests ?? 0,
    }),
  );

  if (message.stop_reason === "refusal") {
    throw new Error("The model declined to process this request.");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No structured report returned by the model");
  }

  return JSON.parse(textBlock.text) as T;
}

const DEFAULT_MAX_ATTEMPTS = 2;

// Rarely, the model returns a bare-minimum schema-valid stub instead of
// real output (empty arrays, a placeholder-style summary) rather than
// throwing an error. isDegenerate lets each call site define what "empty"
// means for its own schema; requestWithRetry treats a degenerate result the
// same as a thrown error and retries once before giving up.
export async function requestWithRetry<T>(
  fn: () => Promise<T>,
  isDegenerate: (result: T) => boolean,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (!isDegenerate(result)) {
        return result;
      }
      lastError = new Error("Model returned an empty/placeholder result");
      console.error(`Attempt ${attempt}: degenerate result, retrying`);
    } catch (err) {
      lastError = err;
      console.error(`Attempt ${attempt} failed:`, err);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed after retries");
}

// Distinguishes a hung/slow request (the timeout added above) from other
// failures, so the row's error_message tells the user this was a transient
// provider issue worth retrying rather than something wrong with their input.
// The SDK's error classes never override `Error`'s default `.name` ("Error"
// for all of them), so this has to check the class itself rather than
// `.name` - checking `.name` would silently never match.
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return "This took too long to respond, most likely a temporary issue with our AI provider. Please try again.";
  }
  return err instanceof Error ? err.message : "Unknown error";
}

// Shared by analyze (submissions) and weekly-monitor (niche_updates) -
// both tables use the same processing/complete/failed status shape. Never
// throws: this runs from a catch block, so if the update itself fails
// (rather than returning a normal {error} result), that failure is only
// logged, not left to escape as an unhandled rejection in the caller.
export async function markFailed(
  supabase: SupabaseClient,
  table: string,
  id: string,
  errorMessage: string,
): Promise<void> {
  try {
    // .select() so a zero-row match (stale/deleted id) is visible - without
    // it, supabase-js reports no error at all for an update that touched
    // nothing, silently leaving the row (if it still exists) stuck instead
    // of ever reaching "failed".
    const { data, error } = await supabase
      .from(table)
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", id)
      .select("id");
    if (error) console.error(`Failed to mark ${table} row as failed:`, error);
    else if (!data || data.length === 0) {
      console.error(`markFailed matched no rows in ${table} for id ${id}`);
    }
  } catch (err) {
    console.error(`Failed to mark ${table} row as failed:`, err);
  }
}
