// Stable backend error codes → user-facing copy. Unknown codes fall back to a
// generic message so internal details are never shown.
const MESSAGES: Record<string, string> = {
  // onboarding
  invalid_invite: "That invite code isn't valid. Check it with your lead.",
  invalid_callsign: "Callsigns use 3–24 letters, numbers, _ or -.",
  callsign_taken: "That callsign is already in use in this workspace.",
  already_member: "This device already belongs to a workspace. Sign out first.",
  unauthenticated: "Your session expired. Please join again.",
  // desk
  no_active_shift: "No desk is on duty right now. Contact your lead directly if this is an emergency.",
  desk_selection_required: "More than one desk is active. Choose a desk first.",
  invalid_category: "Choose a request type.",
  note_too_long: "Notes are limited to 140 characters.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  not_a_member: "Your membership was removed. Sign out and join again.",
  not_authorized: "You don't have permission to do that.",
  ping_not_found: "That request is no longer available.",
  not_acknowledgeable: "Announcements don't need acknowledgment.",
  // shifts
  too_early: "Assume Duty opens 15 minutes before your shift starts.",
  shift_ended: "This shift has already ended.",
  not_assigned: "You're not the primary on this shift.",
  shift_not_found: "That shift no longer exists.",
  desk_overlap: "Another shift already covers this desk at that time.",
  primary_conflict: "The primary is already scheduled during that time.",
  backup_conflict: "The backup is the primary on an overlapping shift.",
  backup_equals_primary: "Primary and backup must be different people.",
  primary_not_found: "Primary member not found in this workspace.",
  backup_not_found: "Backup member not found in this workspace.",
  shift_in_past: "That shift would end in the past.",
  shift_too_long: "Shifts are limited to 24 hours.",
  invalid_time_range: "End time must differ from start time.",
  nonexistent_local_time: "That time doesn't exist on that date (daylight saving change).",
  invalid_desk_label: "Desk names are 1–40 characters.",
  // alerts & import
  invalid_message_length: "Alerts must be 3–280 characters.",
  invalid_priority: "Choose a priority.",
  llm_not_configured: "Smart Import isn't configured on this server yet.",
  llm_unavailable: "The schedule parser is unavailable. Try again shortly.",
  llm_refused: "The parser couldn't process this text. Try simplifying it.",
  llm_truncated: "That schedule is too long to parse at once. Split it up.",
  llm_invalid_output: "The parser returned an unreadable result. Try again.",
  invalid_text_length: "Paste between 10 and 8,000 characters.",
  invalid_week_start: "Choose the week this schedule starts.",
  network_error: "Can't reach nxtshift. Check your connection.",
};

export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, status?: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return "unknown";
}

export function userMessage(error: unknown): string {
  return MESSAGES[errorCode(error)] ?? "Something went wrong. Please try again.";
}

/** Human-readable text for a known code (used for per-row import issues). */
export function describeCode(code: string): string {
  return MESSAGES[code] ?? code.replace(/_/g, " ");
}
