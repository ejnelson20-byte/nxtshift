// POST /publish-top-alert  { message, priority, client_request_id }
// Lead role, length limits, fan-out caps and rate limits are enforced in the
// publish_top_alert RPC. The response reports only a recipient count.
import { callRpc } from "../_shared/db.ts";
import { requireUser, type BaseDeps } from "../_shared/deps.ts";
import { dispatchOutbox } from "../_shared/dispatcher.ts";
import { assertOnlyKeys, HttpError, isUuid, json, readJsonObject, serveJson } from "../_shared/http.ts";

export function createPublishTopAlertHandler(deps: BaseDeps) {
  return serveJson(async (req) => {
    const user = await requireUser(req, deps);
    const body = await readJsonObject(req, 2048);
    assertOnlyKeys(body, ["message", "priority", "client_request_id"]);
    if (typeof body.message !== "string" || body.message.trim().length < 3 || body.message.length > 280) {
      throw new HttpError(400, "invalid_message_length");
    }
    if (!["normal", "high", "critical"].includes(String(body.priority))) throw new HttpError(400, "invalid_priority");
    if (!isUuid(body.client_request_id)) throw new HttpError(400, "missing_request_id");

    const result = await callRpc<{ status: string; ping_id: string; recipients_queued?: number }>(
      deps.userClient(user.jwt),
      "publish_top_alert",
      { p_message: body.message, p_priority: body.priority, p_client_request_id: body.client_request_id },
    );

    if (result.status === "published") {
      try {
        await dispatchOutbox(deps.service, deps.fetch, {
          runEscalations: false,
          checkReceipts: false,
          maxBatches: 3,
          batchSize: 100,
          expoAccessToken: deps.expoAccessToken,
        });
      } catch {
        console.warn(JSON.stringify({ level: "warn", event: "inline_dispatch_failed" }));
      }
    }
    return json({ status: result.status, ping_id: result.ping_id, recipients_queued: result.recipients_queued ?? 0 });
  });
}
