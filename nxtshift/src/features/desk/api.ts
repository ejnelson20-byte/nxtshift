import { requireSupabase } from "@/lib/supabase";
import { invokeFunction, rpc, toApiError } from "@/services/api";
import type { DeskStatus, PingRow, TopAlert } from "@/types/domain";
import type { PingPresetId } from "@/lib/validation";

export type RouteDeskPingResponse = {
  status: "routed" | "duplicate";
  ping_id: string;
  desk_label: string | null;
  escalation: "scheduled" | "immediate" | "none" | "pending" | "escalated";
  dispatch: "accepted_by_push_service" | "queued";
};

export async function fetchDeskStatus(): Promise<DeskStatus[]> {
  return (await rpc<DeskStatus[]>("get_desk_status")) ?? [];
}

export function sendDeskPing(input: {
  preset: PingPresetId;
  clientRequestId: string;
  deskLabel?: string;
  note?: string;
}): Promise<RouteDeskPingResponse> {
  return invokeFunction<RouteDeskPingResponse>("route-desk-ping", {
    preset: input.preset,
    client_request_id: input.clientRequestId,
    ...(input.deskLabel ? { desk_label: input.deskLabel } : {}),
    ...(input.note ? { note: input.note } : {}),
  });
}

const since24h = () => new Date(Date.now() - 24 * 3600_000).toISOString();

export async function fetchTopAlerts(): Promise<TopAlert[]> {
  const { data, error } = await requireSupabase()
    .from("pings")
    .select("id, message, priority, created_at")
    .eq("category", "top_alert")
    .gt("created_at", since24h())
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) throw toApiError(error);
  return (data ?? []) as TopAlert[];
}

/** Desk pings visible to the caller via RLS (sent by, or addressed to, them). */
export async function fetchVisibleDeskPings(): Promise<PingRow[]> {
  const { data, error } = await requireSupabase()
    .from("pings")
    .select(
      "id, category, preset, message, target_shift_id, sender_member_id, acknowledged_at, escalated_at, created_at",
    )
    .neq("category", "top_alert")
    .gt("created_at", since24h())
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw toApiError(error);
  return (data ?? []) as PingRow[];
}

export function acknowledgePing(
  pingId: string,
): Promise<{ status: "acknowledged" | "already_acknowledged"; acknowledged_at: string }> {
  return rpc("acknowledge_ping", { p_ping_id: pingId });
}
