// Integration-test support: run real Edge Function handlers against the real
// migrations (PGlite) with mocked external services (Expo, LLM).
import type { AuthVerifier, RpcClient, RpcResult } from "../../functions/_shared/db.ts";
import type { BaseDeps } from "../../functions/_shared/deps.ts";
import type { FetchLike } from "../../functions/_shared/expo-push.ts";
import type { TestDb } from "../db/harness.ts";

const SET_RETURNING = new Set(["svc_claim_push_batch", "svc_claim_receipt_batch", "get_desk_status"]);

/** supabase-js-compatible rpc() backed by PGlite, as a user or service role. */
export function pgRpc(db: TestDb, uid: string | null): RpcClient {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
      const entries = Object.entries(args);
      const params = entries.map(([, v]) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v));
      const call = `public.${fn}(${entries.map(([k], i) => `${k} => $${i + 1}`).join(", ")})`;
      const sql = SET_RETURNING.has(fn) ? `select * from ${call}` : `select ${call} as r`;
      try {
        const rows = uid ? await db.asUser(uid, sql, params) : await db.asService(sql, params);
        return { data: (SET_RETURNING.has(fn) ? rows : rows[0]?.r) as T, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message, code: (error as { code?: string }).code } };
      }
    },
  };
}

export const jwtFor = (uid: string) => `test-jwt.${uid}`;

export const fakeAuth: AuthVerifier = {
  async verify(jwt: string) {
    const m = /^test-jwt\.(.+)$/.exec(jwt);
    return m ? { id: m[1] } : null;
  },
};

export type ExpoCall = { url: string; body: unknown };

/** Programmable Expo API mock. */
export function mockExpo() {
  const calls: ExpoCall[] = [];
  let sendHandler: (messages: Array<Record<string, unknown>>) => Response = (messages) =>
    Response.json({ data: messages.map((_, i) => ({ status: "ok", id: `ticket-${calls.length}-${i}` })) });
  let receiptHandler: (ids: string[]) => Response = (ids) =>
    Response.json({ data: Object.fromEntries(ids.map((id) => [id, { status: "ok" }])) });

  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "null"));
    calls.push({ url, body });
    if (url.endsWith("/push/send")) return sendHandler(body);
    if (url.endsWith("/push/getReceipts")) return receiptHandler(body.ids);
    throw new Error(`unexpected url ${url}`);
  };

  return {
    fetch,
    calls,
    sent: () =>
      calls.filter((c) => c.url.endsWith("/push/send")).flatMap((c) => c.body as Array<Record<string, unknown>>),
    onSend(h: typeof sendHandler) {
      sendHandler = h;
    },
    onReceipts(h: typeof receiptHandler) {
      receiptHandler = h;
    },
  };
}

export function baseDeps(db: TestDb, fetch: FetchLike): BaseDeps {
  return {
    auth: fakeAuth,
    userClient: (jwt: string) => pgRpc(db, jwt.replace(/^test-jwt\./, "")),
    service: pgRpc(db, null),
    fetch,
  };
}

export function post(body: unknown, opts: { uid?: string; headers?: Record<string, string> } = {}): Request {
  return new Request("http://localhost/fn", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.uid ? { authorization: `Bearer ${jwtFor(opts.uid)}` } : {}),
      ...opts.headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
