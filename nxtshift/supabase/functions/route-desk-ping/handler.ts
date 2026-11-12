// POST /route-desk-ping  { preset, client_request_id, desk_label?, note? }
// Resolves the active shift server-side (request_desk_ping RPC as the user),
// then dispatches immediately. The response never includes recipient identity
// and never claims delivery — only that the push provider accepted the message.
import { callRpc } from "../_shared/db.ts";
import { requireUser, type BaseDeps } from "../_shared/deps.ts";
import { dispatchOutbox } from "../_shared/dispatcher.ts";
import { assertOnlyKeys, HttpError, isUuid, json, readJsonObject, serveJson } from "../_shared/http.ts";

export const PING_PRESETS = ["front_door", "urgent_issue", "supervisor_check", "general_request"] as const;

type RouteResult = {
  status: "routed" | "duplicate";
  ping_id: string;
  desk_label?: string;
  escalation: "scheduled" | "immediate" | "none" | "pending" | "escalated";
};

export function createRouteDeskPingHandler(deps: BaseDeps) {
  return serveJson(async (req) => {
    const user = await requireUser(req, deps);
    const body = await readJsonObject(req, 2048);
    assertOnlyKeys(body, ["preset", "client_request_id", "desk_label", "note"]);

    if (typeof body.preset !== "string" || !(PING_PRESETS as readonly string[]).includes(body.preset)) {
      throw new HttpError(400, "invalid_category");
    }
    if (!isUuid(body.client_request_id)) throw new HttpError(400, "missing_request_id");
    if (body.desk_label != null && (typeof body.desk_label !== "string" || body.desk_label.length > 40)) {
      throw new HttpError(400, "invalid_desk_label");
    }
    if (body.note != null && (typeof body.note !== "string" || body.note.length > 140)) {
      throw new HttpError(400, "note_too_long");
    }

    const result = await callRpc<RouteResult>(deps.userClient(user.jwt), "request_desk_ping", {
      p_preset: body.preset,
      p_client_request_id: body.client_request_id,
      p_desk_label: body.desk_label ?? null,
      p_note: body.note ?? null,
    });

    // Immediate dispatch for low latency. Failures here are not fatal: the
    // outbox row is durable and the scheduled dispatcher retries it.
    let dispatch: "accepted_by_push_service" | "queued" = "queued";
    if (result.status === "routed") {
      try {
        const summary = await dispatchOutbox(deps.service, deps.fetch, {
          runEscalations: false,
          checkReceipts: false,
          maxBatches: 1,
          batchSize: 50,
          expoAccessToken: deps.expoAccessToken,
        });
        if (summary.outcomes.some((o) => o.ping_id === result.ping_id && o.outcome === "accepted")) {
          dispatch = "accepted_by_push_service";
        }
      } catch {
        console.warn(JSON.stringify({ level: "warn", event: "inline_dispatch_failed" }));
      }
    }

    return json({
      status: result.status,
      ping_id: result.ping_id,
      desk_label: result.desk_label ?? null,
      escalation: result.escalation,
      dispatch,
    });
  });
}
