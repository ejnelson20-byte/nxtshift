import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-client";
import { isLeadRole, useSessionStore } from "@/stores/session-store";
import * as api from "./api";

function useIsLead() {
  return useSessionStore((s) => isLeadRole(s.profile));
}

export function useLeadSummary() {
  const enabled = useIsLead();
  return useQuery({ queryKey: queryKeys.leadSummary, queryFn: api.fetchLeadSummary, enabled, refetchInterval: 60_000 });
}

export function useLeadMembers() {
  const enabled = useIsLead();
  return useQuery({ queryKey: queryKeys.leadMembers, queryFn: api.fetchLeadMembers, enabled });
}

export function useOpenPings() {
  const enabled = useIsLead();
  return useQuery({ queryKey: queryKeys.leadOpenPings, queryFn: api.fetchOpenPings, enabled });
}

export function useLeadShifts(from: string, to: string) {
  const enabled = useIsLead();
  return useQuery({ queryKey: queryKeys.leadShifts(from, to), queryFn: () => api.fetchLeadShifts(from, to), enabled });
}

export function useInvite() {
  const enabled = useIsLead();
  return useQuery({ queryKey: queryKeys.leadInvite, queryFn: api.fetchInvite, enabled, staleTime: 5 * 60_000 });
}

function useInvalidateSchedule() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["lead"] });
    void qc.invalidateQueries({ queryKey: queryKeys.myShifts });
    void qc.invalidateQueries({ queryKey: queryKeys.deskStatus });
  };
}

export function useUpsertShift() {
  const invalidate = useInvalidateSchedule();
  return useMutation({ mutationFn: api.upsertShift, onSuccess: invalidate });
}

export function useDeleteShift() {
  const invalidate = useInvalidateSchedule();
  return useMutation({ mutationFn: api.deleteShift, onSuccess: invalidate });
}

export function usePublishTopAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.publishTopAlert,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.topAlerts }),
  });
}

export function useRotateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.rotateInvite,
    onSuccess: (data) => qc.setQueryData(queryKeys.leadInvite, data),
  });
}

export function useSetMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: "member" | "lead" | "admin" }) =>
      api.setMemberRole(memberId, role),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.leadMembers }),
  });
}
