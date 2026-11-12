// POST /join-workspace  { invite_code, callsign }
// Caller must hold a Supabase (anonymous) session. The auth uid is taken from
// the verified JWT, never from the body. Per-IP limits are applied here; the
// SQL function adds per-identity, per-workspace and global throttles.
import { callRpc } from "../_shared/db.ts";
import { clientIp, requireUser, type BaseDeps } from "../_shared/deps.ts";
import {
  assertOnlyKeys,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  serveJson,
  sha256Hex,
} from "../_shared/http.ts";

export type JoinDeps = Pick<BaseDeps, "auth" | "service"> & { rateLimitSalt: string };

const STATUS: Record<string, number> = {
  invalid_invite: 400,
  invalid_callsign: 400,
  callsign_taken: 409,
  already_member: 409,
  rate_limited: 429,
  unauthenticated: 401,
};

export function createJoinHandler(deps: JoinDeps) {
  return serveJson(async (req) => {
    const user = await requireUser(req, deps);
    const body = await readJsonObject(req, 1024);
    assertOnlyKeys(body, ["invite_code", "callsign"]);
    const invite = typeof body.invite_code === "string" ? body.invite_code.trim().toUpperCase() : "";
    const callsign = typeof body.callsign === "string" ? body.callsign.trim() : "";
    if (!/^[A-Z0-9]{6}$/.test(invite)) throw new HttpError(400, "invalid_invite");
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(callsign)) throw new HttpError(400, "invalid_callsign");

    const ipHash = (await sha256Hex(`${deps.rateLimitSalt}:${clientIp(req)}`)).slice(0, 32);
    const allowed = await callRpc<boolean>(deps.service, "svc_rate_limit_hit", {
      p_bucket: `join:ip:${ipHash}`,
      p_max: 20,
      p_window_seconds: 3600,
    });
    if (!allowed) return errorResponse(429, "rate_limited");

    const result = await callRpc<{ ok: boolean; error?: string; status?: string; member_id?: string; role?: string }>(
      deps.service,
      "svc_join_workspace",
      { p_auth_uid: user.id, p_invite_code: invite, p_callsign: callsign },
    );
    if (!result.ok) {
      const code = result.error ?? "join_failed";
      return errorResponse(STATUS[code] ?? 400, code);
    }
    return json({ status: result.status, member_id: result.member_id, role: result.role });
  });
}
