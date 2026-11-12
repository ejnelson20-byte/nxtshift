import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "@/lib/query-client";
import { useSessionStore } from "@/stores/session-store";
import { assumeDuty, fetchMyShifts } from "./api";
import { reconcileShiftReminders } from "./reminder-sync";

export function useMyShifts() {
  const memberId = useSessionStore((s) => s.profile?.member_id);
  return useQuery({
    queryKey: queryKeys.myShifts,
    queryFn: () => fetchMyShifts(memberId!),
    enabled: Boolean(memberId),
  });
}

/**
 * Keeps local reminders in sync with my shifts. Runs whenever the shift list
 * changes — which includes launch and resume, because the query refetches on
 * focus — so added/edited/removed shifts are reconciled without duplicates.
 */
export function useShiftReminderSync() {
  const memberId = useSessionStore((s) => s.profile?.member_id);
  const { data } = useMyShifts();
  useEffect(() => {
    if (!memberId || !data) return;
    void reconcileShiftReminders(
      data.map((s) => ({
        id: s.id,
        desk_label: s.desk_label,
        start_time: s.start_time,
        isPrimary: s.assigned_member_id === memberId,
      })),
    ).catch(() => undefined);
  }, [data, memberId]);
}

export function useAssumeDuty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assumeDuty,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.myShifts });
      void qc.invalidateQueries({ queryKey: queryKeys.deskStatus });
    },
  });
}
