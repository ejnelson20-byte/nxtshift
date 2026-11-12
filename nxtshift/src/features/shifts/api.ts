import { requireSupabase } from "@/lib/supabase";
import { rpc, toApiError } from "@/services/api";
import type { Shift } from "@/types/domain";

/** Shifts where I'm primary or backup (RLS also enforces this). */
export async function fetchMyShifts(memberId: string): Promise<Shift[]> {
  const { data, error } = await requireSupabase()
    .from("shifts")
    .select("id, desk_label, assigned_member_id, backup_member_id, start_time, end_time, is_checked_in")
    .or(`assigned_member_id.eq.${memberId},backup_member_id.eq.${memberId}`)
    .gt("end_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(50);
  if (error) throw toApiError(error);
  return (data ?? []) as Shift[];
}

export function assumeDuty(
  shiftId: string,
): Promise<{ status: "checked_in" | "already_checked_in"; relieved_previous_shift?: boolean }> {
  return rpc("assume_duty", { p_shift_id: shiftId });
}

export const CHECK_IN_WINDOW_MS = 15 * 60_000;

export function canAssumeDuty(shift: Shift, memberId: string, now: number): boolean {
  const start = new Date(shift.start_time).getTime();
  const end = new Date(shift.end_time).getTime();
  return (
    shift.assigned_member_id === memberId && !shift.is_checked_in && now >= start - CHECK_IN_WINDOW_MS && now < end
  );
}
