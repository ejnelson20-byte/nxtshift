import { z } from "zod";

// Only EXPO_PUBLIC_* variables are available in the client bundle. They are
// inlined at build time, so they must be referenced statically.
const raw = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
};

const schema = z.object({
  supabaseUrl: z.url({ protocol: /^https?$/ }),
  supabaseKey: z
    .string()
    .min(20)
    // A service-role/secret key must never be embedded in the client.
    .refine((k) => !k.startsWith("sb_secret_"), "Secret keys must not be used in the app")
    .refine((k) => !isServiceRoleJwt(k), "The service-role key must not be used in the app"),
  easProjectId: z.string().uuid().optional(),
});

function isServiceRoleJwt(key: string): boolean {
  const parts = key.split(".");
  if (parts.length !== 3 || !parts[1]) return false;
  try {
    const payload = JSON.parse(globalThis.atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export type AppEnv = z.infer<typeof schema>;

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; issues: string[] };

export function validateEnv(input: Record<string, unknown> = raw): EnvResult {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, env: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`) };
}

export const envResult = validateEnv();
