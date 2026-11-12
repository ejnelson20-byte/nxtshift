import { useEffect } from "react";
import { AppState } from "react-native";
import { usePingsRealtime } from "@/features/desk/hooks";
import { registerForPush, watchPushTokenChanges } from "@/features/notifications/registration";
import { useShiftReminderSync } from "@/features/shifts/hooks";
import { useSessionStore } from "@/stores/session-store";
import { refreshProfile } from "./auth-service";

/** Side effects that run only while a member is signed in. */
export function useSignedInEffects(): void {
  const workspaceId = useSessionStore((s) => s.profile?.workspace.id);

  usePingsRealtime(workspaceId);
  useShiftReminderSync();

  useEffect(() => {
    // Keep the device token current (no permission prompt here).
    void registerForPush({ prompt: false });
    const stopWatching = watchPushTokenChanges();
    // Re-verify membership/role with the server whenever the app resumes.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshProfile().catch(() => undefined);
    });
    return () => {
      stopWatching();
      sub.remove();
    };
  }, []);
}
