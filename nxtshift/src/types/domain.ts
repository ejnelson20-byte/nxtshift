export type MemberRole = "member" | "lead" | "admin";
export type PingCategory = "urgent_desk" | "relief_check" | "top_alert";
export type AlertPriority = "normal" | "high" | "critical";

export type MemberContext = {
  member_id: string;
  callsign: string;
  role: MemberRole;
  has_push_token: boolean;
  workspace: { id: string; name: string; timezone: string };
};

export type DeskStatus = {
  desk_label: string;
  status: "checked_in" | "awaiting_relief";
  ends_at: string;
};

export type TopAlert = {
  id: string;
  message: string;
  priority: AlertPriority;
  created_at: string;
};

export type PingRow = {
  id: string;
  category: PingCategory;
  preset: string | null;
  message: string | null;
  target_shift_id: string | null;
  sender_member_id: string | null;
  acknowledged_at: string | null;
  escalated_at: string | null;
  created_at: string;
};

export type Shift = {
  id: string;
  desk_label: string;
  assigned_member_id: string | null;
  backup_member_id: string | null;
  start_time: string;
  end_time: string;
  is_checked_in: boolean;
};

export type LeadShift = Shift & {
  assigned_callsign: string | null;
  backup_callsign: string | null;
};

export type LeadMember = {
  id: string;
  callsign: string;
  role: MemberRole;
  has_device: boolean;
  created_at: string;
};

export type LeadSummary = {
  active_shifts: number;
  upcoming_shifts: number;
  awaiting_relief: number;
  unacknowledged_urgent: number;
};

export type OpenPing = {
  id: string;
  category: PingCategory;
  preset: string | null;
  message: string | null;
  created_at: string;
  escalated_at: string | null;
  desk_label: string;
};
