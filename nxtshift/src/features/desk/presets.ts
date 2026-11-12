import type { PingPresetId } from "@/lib/validation";

// Presets map onto the backend's supported categories (server-side mapping in
// request_desk_ping): urgent presets escalate after three minutes.
export const PING_PRESETS: readonly {
  id: PingPresetId;
  label: string;
  description: string;
  escalates: boolean;
}[] = [
  {
    id: "front_door",
    label: "Front Door / Relief Needed",
    description: "Someone needs the door or the desk needs relief.",
    escalates: true,
  },
  { id: "urgent_issue", label: "Urgent Issue", description: "Needs attention right now.", escalates: true },
  {
    id: "supervisor_check",
    label: "Supervisor Check",
    description: "Ask the desk to check in with a supervisor.",
    escalates: false,
  },
  {
    id: "general_request",
    label: "General Desk Request",
    description: "Non-urgent request for the desk.",
    escalates: false,
  },
];

export function presetLabel(id: string | null): string {
  return PING_PRESETS.find((p) => p.id === id)?.label ?? "Desk request";
}
