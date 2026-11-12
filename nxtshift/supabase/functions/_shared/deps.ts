import type { AuthVerifier, RpcClient } from "./db.ts";
import type { FetchLike } from "./expo-push.ts";
import { bearerToken, HttpError } from "./http.ts";

/** Dependencies injected into handlers (real clients in index.ts, fakes in tests). */
export type BaseDeps = {
  auth: AuthVerifier;
  /** RPC client acting as the end user (JWT forwarded → auth.uid() + RLS). */
  userClient: (jwt: string) => RpcClient;
  /** Service-role RPC client. Never exposed to callers. */
  service: RpcClient;
  fetch: FetchLike;
  expoAccessToken?: string;
};

export async function requireUser(req: Request, deps: Pick<BaseDeps, "auth">): Promise<{ id: string; jwt: string }> {
  const jwt = bearerToken(req);
  if (!jwt) throw new HttpError(401, "unauthenticated");
  const user = await deps.auth.verify(jwt);
  if (!user) throw new HttpError(401, "unauthenticated");
  return { id: user.id, jwt };
}

/** Best-effort client IP for rate limiting (never stored raw). */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}
