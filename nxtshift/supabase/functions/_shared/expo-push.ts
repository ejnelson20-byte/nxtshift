// Expo Push API client + result classification.
// Docs: https://docs.expo.dev/push-notifications/sending-notifications/

export const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const CHUNK_SIZE = 100; // Expo limit per send request
const RECEIPT_CHUNK = 1000; // Expo limit per receipts request

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type OutboxItem = {
  id: string;
  kind: string;
  ping_id: string | null;
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  category_id: string | null;
  channel_id: string;
  priority: string;
  attempts: number;
};

export type SendOutcome = {
  id: string;
  outcome: "accepted" | "retry" | "device_not_registered" | "failed";
  ticket_id?: string;
  error?: string;
};

export type ReceiptOutcome = {
  id: string;
  outcome: "ok" | "pending" | "device_not_registered" | "retry" | "error";
  error?: string;
};

type ExpoTicket = { status: "ok"; id: string } | { status: "error"; message?: string; details?: { error?: string } };

type ExpoReceipt = { status: "ok" } | { status: "error"; message?: string; details?: { error?: string } };

export function toExpoMessage(item: OutboxItem): Record<string, unknown> {
  return {
    to: item.token,
    title: item.title,
    body: item.body,
    data: item.data,
    sound: "default",
    priority: item.priority === "default" ? "default" : "high",
    channelId: item.channel_id,
    ...(item.category_id ? { categoryId: item.category_id } : {}),
    // Pings expire with the 24h retention window.
    ttl: 60 * 60 * 24,
  };
}

function headers(accessToken?: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function classifyTicket(id: string, ticket: ExpoTicket | undefined): SendOutcome {
  if (!ticket) return { id, outcome: "retry", error: "missing_ticket" };
  if (ticket.status === "ok") return { id, outcome: "accepted", ticket_id: ticket.id };
  const code = ticket.details?.error ?? "unknown_error";
  switch (code) {
    case "DeviceNotRegistered":
      return { id, outcome: "device_not_registered", error: code };
    case "MessageRateExceeded":
    case "InvalidCredentials": // project misconfiguration; retry after operator fixes credentials
      return { id, outcome: "retry", error: code };
    default:
      return { id, outcome: "failed", error: code.slice(0, 120) };
  }
}

/** Send outbox items; never throws — every item gets an outcome. */
export async function sendPushBatch(
  fetchFn: FetchLike,
  items: OutboxItem[],
  accessToken?: string,
): Promise<SendOutcome[]> {
  const outcomes: SendOutcome[] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetchFn(EXPO_SEND_URL, {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify(chunk.map(toExpoMessage)),
      });
      if (res.status === 429 || res.status >= 500) {
        outcomes.push(...chunk.map((c) => ({ id: c.id, outcome: "retry" as const, error: `http_${res.status}` })));
        continue;
      }
      const payload = (await res.json().catch(() => null)) as { data?: ExpoTicket[]; errors?: unknown } | null;
      if (!res.ok || !payload || !Array.isArray(payload.data)) {
        // Request-level rejection (malformed batch). Retrying won't help.
        outcomes.push(...chunk.map((c) => ({ id: c.id, outcome: "failed" as const, error: `http_${res.status}` })));
        continue;
      }
      chunk.forEach((c, idx) => outcomes.push(classifyTicket(c.id, payload.data?.[idx])));
    } catch {
      outcomes.push(...chunk.map((c) => ({ id: c.id, outcome: "retry" as const, error: "network_error" })));
    }
  }
  return outcomes;
}

export async function fetchReceipts(
  fetchFn: FetchLike,
  tickets: Array<{ id: string; ticket_id: string }>,
  accessToken?: string,
): Promise<ReceiptOutcome[]> {
  const outcomes: ReceiptOutcome[] = [];
  for (let i = 0; i < tickets.length; i += RECEIPT_CHUNK) {
    const chunk = tickets.slice(i, i + RECEIPT_CHUNK);
    try {
      const res = await fetchFn(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({ ids: chunk.map((t) => t.ticket_id) }),
      });
      const payload = res.ok
        ? ((await res.json().catch(() => null)) as { data?: Record<string, ExpoReceipt> } | null)
        : null;
      if (!payload?.data) {
        outcomes.push(...chunk.map((t) => ({ id: t.id, outcome: "pending" as const })));
        continue;
      }
      for (const t of chunk) {
        const receipt = payload.data[t.ticket_id];
        if (!receipt) outcomes.push({ id: t.id, outcome: "pending" });
        else if (receipt.status === "ok") outcomes.push({ id: t.id, outcome: "ok" });
        else {
          const code = receipt.details?.error ?? "unknown_error";
          if (code === "DeviceNotRegistered")
            outcomes.push({ id: t.id, outcome: "device_not_registered", error: code });
          else if (code === "MessageRateExceeded") outcomes.push({ id: t.id, outcome: "retry", error: code });
          else outcomes.push({ id: t.id, outcome: "error", error: code.slice(0, 120) });
        }
      }
    } catch {
      outcomes.push(...chunk.map((t) => ({ id: t.id, outcome: "pending" as const })));
    }
  }
  return outcomes;
}
