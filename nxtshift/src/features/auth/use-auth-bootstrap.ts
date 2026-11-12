import { useEffect } from "react";
import { getSupabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session-store";
import { restoreSession, signOutLocal } from "./auth-service";

/** Restores the session on launch and tracks auth state changes. */
export function useAuthBootstrap(): void {
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      useSessionStore.getState().setUnconfigured();
      return;
    }
    void restoreSession();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const store = useSessionStore.getState();
      store.setSession(session);
      // SIGNED_OUT without a user action means the refresh token was rejected
      // (expired/revoked). The anonymous identity is unrecoverable.
      if (event === "SIGNED_OUT" && store.status === "ready") void signOutLocal("expired");
    });
    return () => data.subscription.unsubscribe();
  }, []);
}
