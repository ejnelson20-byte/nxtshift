// LLM extraction port. The concrete Claude implementation lives in
// parse-shift-schedule/index.ts (Anthropic SDK); handlers depend only on this
// interface so tests can mock the model deterministically.
import {
  buildUserMessage,
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  validateExtraction,
  type Extraction,
} from "./schedule.ts";

export type ExtractionRequest = {
  system: string;
  user: string;
  schema: typeof EXTRACTION_JSON_SCHEMA;
};

/** Returns the model's raw JSON text, or throws LlmError. */
export type ExtractFn = (req: ExtractionRequest) => Promise<string>;

export class LlmError extends Error {
  readonly code: "llm_unavailable" | "llm_refused" | "llm_truncated" | "llm_invalid_output";
  constructor(code: LlmError["code"], message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export async function extractSchedule(extract: ExtractFn, text: string, weekStart: string): Promise<Extraction> {
  const raw = await extract({
    system: EXTRACTION_SYSTEM_PROMPT,
    user: buildUserMessage(text, weekStart),
    schema: EXTRACTION_JSON_SCHEMA,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LlmError("llm_invalid_output", "not_json");
  }
  try {
    return validateExtraction(parsed);
  } catch (error) {
    throw new LlmError("llm_invalid_output", (error as Error).message);
  }
}
