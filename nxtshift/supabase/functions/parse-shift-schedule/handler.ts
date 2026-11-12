// POST /parse-shift-schedule  { text, week_start, default_desk_label? }
// Lead/admin only. Returns a reviewable preview; never inserts shifts.
import { callRpc } from "../_shared/db.ts";
import { requireUser, type BaseDeps } from "../_shared/deps.ts";
import { assertOnlyKeys, errorResponse, HttpError, json, readJsonObject, serveJson } from "../_shared/http.ts";
import { extractSchedule, LlmError, type ExtractFn } from "../_shared/llm.ts";
import { importableRows, MAX_SCHEDULE_CHARS, resolveExtraction } from "../_shared/schedule.ts";

export type ParseDeps = Pick<BaseDeps, "auth" | "service" | "userClient"> & {
  /** Null when LLM_API_KEY is not configured. */
  extract: ExtractFn | null;
};

type ImportContext = { member_id: string; workspace_id: string; timezone: string; callsigns: string[] };
type PreviewResult = { status: string; rows: Array<{ index: number; ok: boolean; error?: string }> };

const LLM_STATUS: Record<LlmError["code"], number> = {
  llm_unavailable: 503,
  llm_refused: 422,
  llm_truncated: 422,
  llm_invalid_output: 502,
};

export function createParseScheduleHandler(deps: ParseDeps) {
  return serveJson(async (req) => {
    const user = await requireUser(req, deps);
    const ctx = await callRpc<ImportContext | null>(deps.service, "svc_lead_import_context", { p_auth_uid: user.id });
    if (!ctx) return errorResponse(403, "not_authorized");

    const body = await readJsonObject(req, MAX_SCHEDULE_CHARS * 4 + 1024);
    assertOnlyKeys(body, ["text", "week_start", "default_desk_label"]);
    const text = typeof body.text === "string" ? body.text.replace(/\r\n?/g, "\n").trim() : "";
    if (text.length < 10 || text.length > MAX_SCHEDULE_CHARS) throw new HttpError(400, "invalid_text_length");
    const weekStart = typeof body.week_start === "string" ? body.week_start : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || Number.isNaN(Date.parse(`${weekStart}T00:00:00Z`))) {
      throw new HttpError(400, "invalid_week_start");
    }
    const defaultDesk =
      typeof body.default_desk_label === "string" ? body.default_desk_label.trim().slice(0, 40) || null : null;

    const perMember = await callRpc<boolean>(deps.service, "svc_rate_limit_hit", {
      p_bucket: `parse:member:${ctx.member_id}`,
      p_max: 10,
      p_window_seconds: 3600,
    });
    const perWorkspace = await callRpc<boolean>(deps.service, "svc_rate_limit_hit", {
      p_bucket: `parse:ws:${ctx.workspace_id}`,
      p_max: 50,
      p_window_seconds: 86400,
    });
    if (!perMember || !perWorkspace) return errorResponse(429, "rate_limited");

    if (!deps.extract) return errorResponse(503, "llm_not_configured");

    let extraction;
    try {
      extraction = await extractSchedule(deps.extract, text, weekStart);
    } catch (error) {
      if (error instanceof LlmError) return errorResponse(LLM_STATUS[error.code], error.code);
      throw error;
    }

    const result = resolveExtraction(extraction, { text, weekStart, defaultDesk, callsigns: ctx.callsigns });

    // Server-side dry run for complete rows: catches DST gaps, existing-shift
    // overlaps and double bookings using the same rules as the real import.
    const candidates = importableRows(result);
    if (candidates.length > 0) {
      const preview = await callRpc<PreviewResult>(deps.userClient(user.jwt), "lead_import_shifts", {
        p_rows: candidates.map((c) => c.row),
        p_commit: false,
      });
      for (const row of preview.rows) {
        if (!row.ok && row.error) result.shifts[candidates[row.index].index].issues.push(row.error);
      }
    }

    return json({ ...result, timezone: ctx.timezone });
  });
}
