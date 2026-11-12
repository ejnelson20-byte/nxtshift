import { invokeFunction, rpc } from "@/services/api";
import type { AlertPriority, LeadMember, LeadShift, LeadSummary, MemberRole, OpenPing } from "@/types/domain";

export const fetchLeadSummary = () => rpc<LeadSummary>("lead_dashboard_summary");
export const fetchLeadMembers = async () => (await rpc<LeadMember[]>("lead_list_members")) ?? [];
export const fetchOpenPings = async () => (await rpc<OpenPing[]>("lead_list_open_pings")) ?? [];
export const fetchLeadShifts = async (from: string, to: string) =>
  (await rpc<LeadShift[]>("lead_list_shifts", { p_from: from, p_to: to })) ?? [];
export const fetchInvite = () =>
  rpc<{ invite_code: string; expires_at: string | null; active: boolean }>("lead_get_invite");

export function upsertShift(input: {
  shiftId: string | null;
  deskLabel: string;
  date: string;
  start: string;
  end: string;
  assignedMemberId: string | null;
  backupMemberId: string | null;
}) {
  return rpc<{ shift_id: string; start_time: string; end_time: string; warnings: string[] }>("lead_upsert_shift", {
    p_shift_id: input.shiftId,
    p_desk_label: input.deskLabel,
    p_local_date: input.date,
    p_start_local: input.start,
    p_end_local: input.end,
    p_assigned_member_id: input.assignedMemberId,
    p_backup_member_id: input.backupMemberId,
  });
}

export const deleteShift = (shiftId: string) => rpc("lead_delete_shift", { p_shift_id: shiftId });

export function publishTopAlert(input: { message: string; priority: AlertPriority; clientRequestId: string }) {
  return invokeFunction<{ status: string; ping_id: string; recipients_queued: number }>("publish-top-alert", {
    message: input.message,
    priority: input.priority,
    client_request_id: input.clientRequestId,
  });
}

export const retractTopAlert = (pingId: string) => rpc("lead_retract_top_alert", { p_ping_id: pingId });
export const rotateInvite = () =>
  rpc<{ invite_code: string; expires_at: string | null; active: boolean }>("admin_rotate_invite", {});
export const setMemberRole = (memberId: string, role: MemberRole) =>
  rpc("admin_set_member_role", { p_member_id: memberId, p_role: role });
export const removeMember = (memberId: string) => rpc("admin_remove_member", { p_member_id: memberId });
