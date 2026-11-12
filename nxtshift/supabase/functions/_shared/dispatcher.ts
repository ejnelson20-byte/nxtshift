// Outbox dispatcher: escalation sweep → claim → send → record → receipts.
// Safe to run concurrently (DB leases with SKIP LOCKED) and repeatedly.
import { callRpc, type RpcClient } from "./db.ts";
import { fetchReceipts, sendPushBatch, type FetchLike, type OutboxItem, type SendOutcome } from "./expo-push.ts";

export type DispatchSummary = {
  escalated: number;
  claimed: number;
  accepted: number;
  retry: number;
  failed: number;
  device_not_registered: number;
  receipts_checked: number;
  outcomes: Array<Pick<SendOutcome, "id" | "outcome"> & { ping_id: string | null; kind: string }>;
};

export type DispatchOptions = {
  batchSize?: number;
  maxBatches?: number;
  checkReceipts?: boolean;
  runEscalations?: boolean;
  expoAccessToken?: string;
};

export async function dispatchOutbox(
  service: RpcClient,
  fetchFn: FetchLike,
  opts: DispatchOptions = {},
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    escalated: 0,
    claimed: 0,
    accepted: 0,
    retry: 0,
    failed: 0,
    device_not_registered: 0,
    receipts_checked: 0,
    outcomes: [],
  };

  if (opts.runEscalations ?? true) {
    summary.escalated = (await callRpc<number>(service, "run_escalations", { p_limit: 100 })) ?? 0;
  }

  const maxBatches = opts.maxBatches ?? 5;
  for (let i = 0; i < maxBatches; i++) {
    const items =
      (await callRpc<OutboxItem[]>(service, "svc_claim_push_batch", { p_limit: opts.batchSize ?? 100 })) ?? [];
    if (items.length === 0) break;
    summary.claimed += items.length;

    const outcomes = await sendPushBatch(fetchFn, items, opts.expoAccessToken);
    await callRpc(service, "svc_record_push_results", { p_results: outcomes });

    const byId = new Map(items.map((it) => [it.id, it]));
    for (const o of outcomes) {
      summary[o.outcome] += 1;
      const item = byId.get(o.id);
      summary.outcomes.push({ id: o.id, outcome: o.outcome, ping_id: item?.ping_id ?? null, kind: item?.kind ?? "" });
    }
    if (items.length < (opts.batchSize ?? 100)) break;
  }

  if (opts.checkReceipts ?? true) {
    const tickets =
      (await callRpc<Array<{ id: string; ticket_id: string }>>(service, "svc_claim_receipt_batch", {
        p_limit: 1000,
      })) ?? [];
    if (tickets.length > 0) {
      const receipts = await fetchReceipts(fetchFn, tickets, opts.expoAccessToken);
      await callRpc(service, "svc_record_receipts", { p_results: receipts });
      summary.receipts_checked = tickets.length;
    }
  }

  return summary;
}
