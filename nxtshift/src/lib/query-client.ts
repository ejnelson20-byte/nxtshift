import { focusManager, QueryClient } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import { ApiError } from "./errors";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      retry: (count, error) => {
        // Don't retry authorization/business errors — only transient failures.
        if (error instanceof ApiError && error.status && error.status < 500 && error.code !== "network_error")
          return false;
        return count < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
    },
    mutations: {
      // Mutations are never retried automatically; idempotency keys make
      // manual retries safe.
      retry: false,
    },
  },
});

// Treat app foregrounding as window focus so stale queries refetch on resume.
AppState.addEventListener("change", (status) => {
  if (Platform.OS !== "web") focusManager.setFocused(status === "active");
});

export const queryKeys = {
  context: ["context"] as const,
  deskStatus: ["desk-status"] as const,
  topAlerts: ["top-alerts"] as const,
  incomingPings: ["incoming-pings"] as const,
  myPings: ["my-pings"] as const,
  myShifts: ["my-shifts"] as const,
  leadSummary: ["lead", "summary"] as const,
  leadShifts: (from: string, to: string) => ["lead", "shifts", from, to] as const,
  leadMembers: ["lead", "members"] as const,
  leadOpenPings: ["lead", "open-pings"] as const,
  leadInvite: ["lead", "invite"] as const,
};
