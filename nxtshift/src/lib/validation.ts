import { z } from "zod";

// Client-side validation mirrors server rules for fast feedback only. The
// server re-validates everything.
export const INVITE_ALPHABET = /^[A-HJ-NP-Z2-9]{6}$/;

export const joinSchema = z.object({
  inviteCode: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(INVITE_ALPHABET, "Enter the 6-character code (no 0, O, 1 or I).")),
  callsign: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,24}$/, "3–24 letters, numbers, _ or -. Don't use your real name."),
});
export type JoinForm = z.input<typeof joinSchema>;

export const PING_PRESET_IDS = ["front_door", "urgent_issue", "supervisor_check", "general_request"] as const;
export type PingPresetId = (typeof PING_PRESET_IDS)[number];

export const pingSchema = z.object({
  preset: z.enum(PING_PRESET_IDS),
  note: z.string().trim().max(140).optional(),
  deskLabel: z.string().trim().min(1).max(40).optional(),
});

export const topAlertSchema = z.object({
  message: z.string().trim().min(3, "At least 3 characters.").max(280, "Up to 280 characters."),
  priority: z.enum(["normal", "high", "critical"]),
});
export type TopAlertForm = z.infer<typeof topAlertSchema>;

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const shiftFormSchema = z
  .object({
    deskLabel: z.string().trim().min(1, "Required").max(40),
    date: z.string().regex(ISO_DATE, "YYYY-MM-DD"),
    start: z.string().regex(HHMM, "HH:MM (24h)"),
    end: z.string().regex(HHMM, "HH:MM (24h)"),
    assignedMemberId: z.string().uuid().nullable(),
    backupMemberId: z.string().uuid().nullable(),
  })
  .refine((v) => v.start !== v.end, { path: ["end"], message: "End must differ from start" })
  .refine((v) => !v.assignedMemberId || v.assignedMemberId !== v.backupMemberId, {
    path: ["backupMemberId"],
    message: "Backup must differ from primary",
  });
export type ShiftForm = z.infer<typeof shiftFormSchema>;

/** Accepts "0800", "8:00", "08:00" → "08:00"; returns null if invalid. */
export function normalizeTime(input: string): string | null {
  const digits = input.trim().replace(":", "");
  if (!/^\d{3,4}$/.test(digits)) return null;
  const padded = digits.padStart(4, "0");
  const value = `${padded.slice(0, 2)}:${padded.slice(2)}`;
  return HHMM.test(value) ? value : null;
}
