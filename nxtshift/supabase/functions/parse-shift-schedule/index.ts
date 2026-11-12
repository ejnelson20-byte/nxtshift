import Anthropic from "npm:@anthropic-ai/sdk@1";
import { LlmError, type ExtractFn } from "../_shared/llm.ts";
import { loadBaseDeps } from "../_shared/supabase-deps.ts";
import { createParseScheduleHandler } from "./handler.ts";

const apiKey = Deno.env.get("LLM_API_KEY");
const model = Deno.env.get("LLM_MODEL") || "claude-opus-5-5";

function createClaudeExtractor(key: string): ExtractFn {
  const client = new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 2 });
  return async ({ system, user, schema }) => {
    let response;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "medium", format: { type: "json_schema", schema } },
        // Server-side refusal fallback (routes by refusal category).
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new LlmError("llm_unavailable", "rate_limited");
      if (error instanceof Anthropic.APIError) throw new LlmError("llm_unavailable", `api_${error.status ?? "error"}`);
      throw new LlmError("llm_unavailable", "network");
    }
    if (response.stop_reason === "refusal") throw new LlmError("llm_refused");
    if (response.stop_reason === "max_tokens") throw new LlmError("llm_truncated");
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") throw new LlmError("llm_invalid_output", "no_text");
    return text.text;
  };
}

const base = loadBaseDeps();
Deno.serve(createParseScheduleHandler({ ...base, extract: apiKey ? createClaudeExtractor(apiKey) : null }));
