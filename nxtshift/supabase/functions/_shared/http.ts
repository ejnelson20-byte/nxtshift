// HTTP helpers shared by Edge Functions. Runtime-neutral (Web APIs only) so
// handlers are testable under Node as well as Deno.

export const MAX_BODY_BYTES = 16 * 1024;

const baseHeaders: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  // Native clients don't need CORS; allow only the headers supabase-js sends
  // so the functions can also be exercised from tooling.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: baseHeaders });
}

export function errorResponse(status: number, error: string, message?: string): Response {
  return json({ error, ...(message ? { message } : {}) }, status);
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

/** Read a JSON object body with a size cap. Rejects arrays/primitives. */
export async function readJsonObject(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "payload_too_large");
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, "payload_too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_body");
  }
  return parsed as Record<string, unknown>;
}

/** Reject keys outside the allowed set (strict request schemas). */
export function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new HttpError(400, "unknown_field", key);
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** Constant-time string comparison for shared secrets. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Wrap a handler: method checks, OPTIONS, and safe error translation. */
export function serveJson(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: baseHeaders });
    if (req.method !== "POST") return errorResponse(405, "method_not_allowed");
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error.status, error.code);
      // Never echo internal error details (may include SQL or payload text).
      console.error(JSON.stringify({ level: "error", event: "unhandled", name: (error as Error)?.name }));
      return errorResponse(500, "internal_error");
    }
  };
}
