import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { ApiError } from "@/lib/errors";
import { requireSupabase } from "@/lib/supabase";

type PostgrestLikeError = { message: string; code?: string; details?: string | null };

export function toApiError(error: PostgrestLikeError): ApiError {
  // nxtshift RPCs raise P0001 with a stable machine-readable message.
  if (error.code === "P0001") return new ApiError(error.message, 400);
  if (error.code === "PGRST301" || error.code === "401") return new ApiError("unauthenticated", 401);
  if (error.code === "42501") return new ApiError("not_authorized", 403);
  if (/network|fetch|timed? ?out/i.test(error.message)) return new ApiError("network_error");
  return new ApiError("unknown", 500);
}

/** Call a Postgres RPC as the signed-in user. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) throw toApiError(error);
  return data as T;
}

/** Invoke an Edge Function as the signed-in user. */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke<T>(name, { body });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(payload?.error ?? "unknown", response.status);
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    throw new ApiError("network_error");
  }
  throw new ApiError("unknown");
}
