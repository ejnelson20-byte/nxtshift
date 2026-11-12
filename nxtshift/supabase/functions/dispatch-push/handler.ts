// POST /dispatch-push — invoked by pg_cron (pg_net) every ~15 seconds.
// Authenticated by a shared secret header, not a user JWT.
// Runs the escalation sweep, drains the outbox, and checks Expo receipts.
import type { BaseDeps } from "../_shared/deps.ts";
import { dispatchOutbox } from "../_shared/dispatcher.ts";
import { errorResponse, json, serveJson, timingSafeEqual } from "../_shared/http.ts";

export type DispatchDeps = Pick<BaseDeps, "service" | "fetch" | "expoAccessToken"> & { cronSecret: string };

export function createDispatchHandler(deps: DispatchDeps) {
  return serveJson(async (req) => {
    const provided = req.headers.get("x-nxtshift-cron-secret") ?? "";
    if (!deps.cronSecret || deps.cronSecret.length < 32 || !timingSafeEqual(provided, deps.cronSecret)) {
      return errorResponse(401, "unauthorized");
    }
    const summary = await dispatchOutbox(deps.service, deps.fetch, {
      runEscalations: true,
      checkReceipts: true,
      maxBatches: 5,
      batchSize: 100,
      expoAccessToken: deps.expoAccessToken,
    });
    const { outcomes: _omit, ...counts } = summary;
    // Counts only — no tokens, recipients or message content in logs.
    console.log(JSON.stringify({ level: "info", event: "dispatch", ...counts }));
    return json(counts);
  });
}
