import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { queryClient, queryKeys } from "@/lib/query-client";
import { userMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { showBanner } from "@/stores/banner-store";
import { useSessionStore } from "@/stores/session-store";
import { acknowledgePing } from "@/features/desk/api";
import { ACKNOWLEDGE_ACTION } from "./setup";

type PushData = { type?: string; ping_id?: string; shift_id?: string };

/**
 * Handles notification taps and the ACKNOWLEDGE action — including cold starts
 * (useLastNotificationResponse returns the response that launched the app).
 * Responses wait until the session is restored, and the server's answer is
 * the only thing shown as acknowledged.
 */
export function useNotificationResponses(): void {
  const response = Notifications.useLastNotificationResponse();
  const status = useSessionStore((s) => s.status);
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!response || status !== "ready") return;
    const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
    if (handled.current.has(key)) return;
    handled.current.add(key);

    const data = (response.notification.request.content.data ?? {}) as PushData;
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);

    if (data.type === "shift_reminder" || data.type === "shift_handoff") {
      router.navigate("/shifts");
      return;
    }
    if (data.type === "top_alert") {
      router.navigate("/");
      return;
    }
    if (!data.ping_id) return;

    if (response.actionIdentifier === ACKNOWLEDGE_ACTION) {
      acknowledgePing(data.ping_id)
        .then((r) => {
          haptics.success();
          showBanner(
            "success",
            r.status === "already_acknowledged" ? "Already acknowledged." : "Acknowledged. Escalation stopped.",
          );
        })
        .catch((error: unknown) => {
          haptics.error();
          showBanner("error", `Not acknowledged: ${userMessage(error)}`);
        })
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.incomingPings });
        });
    }
    router.navigate("/");
  }, [response, status]);
}
