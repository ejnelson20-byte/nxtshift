import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { queryKeys } from "@/lib/query-client";
import { getSupabase } from "@/lib/supabase";
import { isLeadRole, useSessionStore } from "@/stores/session-store";
import { useMyShifts } from "@/features/shifts/hooks";
import { acknowledgePing, fetchDeskStatus, fetchTopAlerts, fetchVisibleDeskPings, sendDeskPing } from "./api";

export function useDeskStatus() {
  return useQuery({
    queryKey: queryKeys.deskStatus,
    queryFn: fetchDeskStatus,
    // Shift check-ins aren't broadcast to members (roster privacy), so poll
    // gently while the Desk tab is mounted and the app is foregrounded.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useTopAlerts() {
  return useQuery({ queryKey: queryKeys.topAlerts, queryFn: fetchTopAlerts });
}

export function useVisibleDeskPings() {
  return useQuery({ queryKey: queryKeys.incomingPings, queryFn: fetchVisibleDeskPings });
}

/** Unacknowledged pings addressed to me (my shifts, or escalated to me). */
export function useIncomingPings() {
  const profile = useSessionStore((s) => s.profile);
  const pings = useVisibleDeskPings();
  const shifts = useMyShifts();
  const data = useMemo(() => {
    if (!profile || !pings.data) return [];
    const mine = new Map((shifts.data ?? []).map((s) => [s.id, s]));
    return pings.data.filter((p) => {
      if (p.acknowledged_at || p.sender_member_id === profile.member_id || !p.target_shift_id) return false;
      const shift = mine.get(p.target_shift_id);
      if (shift?.assigned_member_id === profile.member_id) return true;
      if (shift?.backup_member_id === profile.member_id && p.escalated_at) return true;
      return isLeadRole(profile) && Boolean(p.escalated_at);
    });
  }, [profile, pings.data, shifts.data]);
  return { ...pings, data };
}

/** My own recent requests, with server-confirmed status. */
export function useMySentPings() {
  const profile = useSessionStore((s) => s.profile);
  const pings = useVisibleDeskPings();
  const data = useMemo(
    () => (pings.data ?? []).filter((p) => p.sender_member_id === profile?.member_id).slice(0, 3),
    [pings.data, profile?.member_id],
  );
  return { ...pings, data };
}

export function useSendDeskPing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendDeskPing,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.incomingPings });
      void qc.invalidateQueries({ queryKey: queryKeys.deskStatus });
    },
  });
}

export function useAcknowledgePing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acknowledgePing,
    // No optimistic update: only a server confirmation counts as acknowledged.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.incomingPings });
      void qc.invalidateQueries({ queryKey: queryKeys.leadOpenPings });
      void qc.invalidateQueries({ queryKey: queryKeys.leadSummary });
    },
  });
}

/**
 * One Realtime subscription per signed-in workspace on `pings`. Events are
 * RLS-filtered by Supabase; payloads are only used as invalidation signals.
 */
export function usePingsRealtime(workspaceId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !workspaceId) return;
    const channel = supabase
      .channel(`pings:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pings", filter: `workspace_id=eq.${workspaceId}` },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.topAlerts });
          void qc.invalidateQueries({ queryKey: queryKeys.incomingPings });
          void qc.invalidateQueries({ queryKey: queryKeys.leadOpenPings });
          void qc.invalidateQueries({ queryKey: queryKeys.leadSummary });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, qc]);
}
