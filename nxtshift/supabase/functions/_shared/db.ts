// Minimal database surface used by handlers. supabase-js clients satisfy it;
// tests substitute an adapter backed by PGlite.
import { HttpError } from "./http.ts";

export type RpcError = { message: string; code?: string };
export type RpcResult<T> = { data: T | null; error: RpcError | null };

export interface RpcClient {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult<T>>;
}

export interface AuthVerifier {
  /** Returns the verified user id for a JWT, or null if invalid/expired. */
  verify(jwt: string): Promise<{ id: string } | null>;
}

/**
 * Business error codes raised by nxtshift RPCs → HTTP status.
 * Anything unknown becomes a generic 500 so SQL details never leak.
 */
const ERROR_STATUS: Record<string, number> = {
  not_a_member: 403,
  not_authorized: 403,
  rate_limited: 429,
  no_active_shift: 409,
  desk_selection_required: 409,
  invalid_category: 400,
  note_too_long: 400,
  missing_request_id: 400,
  invalid_message_length: 400,
  invalid_priority: 400,
  invalid_payload: 400,
  invalid_row_count: 400,
  ping_not_found: 404,
  not_acknowledgeable: 400,
};

export function rpcErrorToHttp(error: RpcError): HttpError {
  const code = error.message;
  const status = ERROR_STATUS[code];
  if (status) return new HttpError(status, code);
  console.error(JSON.stringify({ level: "error", event: "rpc_error", pg_code: error.code ?? null }));
  return new HttpError(500, "internal_error");
}

export async function callRpc<T>(client: RpcClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc<T>(fn, args);
  if (error) throw rpcErrorToHttp(error);
  return data as T;
}
