import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, type AppStateStatus } from "react-native";
import { envResult } from "./env";
import { createChunkedSecureStorage } from "./secure-storage";

let client: SupabaseClient | null = null;

/** Returns the Supabase client, or null when the build is misconfigured. */
export function getSupabase(): SupabaseClient | null {
  if (!envResult.ok) return null;
  if (!client) {
    client = createClient(envResult.env.supabaseUrl, envResult.env.supabaseKey, {
      auth: {
        storage: createChunkedSecureStorage(),
        storageKey: "nxtshift.auth",
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    // Refresh tokens only while foregrounded (recommended for React Native).
    const onChange = (state: AppStateStatus) => {
      if (state === "active") void client?.auth.startAutoRefresh();
      else void client?.auth.stopAutoRefresh();
    };
    AppState.addEventListener("change", onChange);
    if (AppState.currentState === "active") void client.auth.startAutoRefresh();
  }
  return client;
}

export function requireSupabase(): SupabaseClient {
  const supabase = getSupabase();
  if (!supabase) throw new Error("nxtshift is not configured. See .env.example.");
  return supabase;
}
