// Deno-only wiring for real Supabase clients. Imported by index.ts files.
import { createClient } from "npm:@supabase/supabase-js@2";
import type { AuthVerifier, RpcClient } from "./db.ts";
import type { BaseDeps } from "./deps.ts";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadBaseDeps(): BaseDeps {
  const url = requiredEnv("SUPABASE_URL");
  // Supabase injects SUPABASE_ANON_KEY (legacy) and may also provide the newer
  // publishable key; either works for user-scoped clients.
  const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? requiredEnv("SUPABASE_ANON_KEY");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const service = createClient(url, serviceKey, clientOptions);

  const auth: AuthVerifier = {
    async verify(jwt: string) {
      const { data, error } = await service.auth.getUser(jwt);
      if (error || !data.user) return null;
      return { id: data.user.id };
    },
  };

  const userClient = (jwt: string): RpcClient =>
    createClient(url, publicKey, {
      ...clientOptions,
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    }) as unknown as RpcClient;

  return {
    auth,
    userClient,
    service: service as unknown as RpcClient,
    fetch: (input, init) => fetch(input, init),
    expoAccessToken: Deno.env.get("EXPO_ACCESS_TOKEN") || undefined,
  };
}
