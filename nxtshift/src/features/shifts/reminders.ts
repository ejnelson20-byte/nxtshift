// Pure planning logic for local shift reminders (unit-tested).
// Identifiers encode shift id, offset and start time, so any change to a shift
// yields a new identifier and reconciliation replaces the stale reminder.

export const REMINDER_PREFIX = "nxtshift-shift:";
export const REMINDER_OFFSETS_MIN = [60, 30, 15] as const;
/** iOS allows 64 pending local notifications per app; leave headroom. */
export const MAX_PENDING_REMINDERS = 45;
/** Don't schedule reminders that would fire within this window. */
const MIN_LEAD_MS = 5_000;

export type ReminderShift = { id: string; desk_label: string; start_time: string; isPrimary: boolean };

export type PlannedReminder = {
  identifier: string;
  fireAt: Date;
  title: string;
  body: string;
  shiftId: string;
};

export function reminderId(shiftId: string, offsetMin: number, startMs: number): string {
  return `${REMINDER_PREFIX}${shiftId}:${offsetMin}:${startMs}`;
}

export function planReminders(shifts: ReminderShift[], now: Date, max = MAX_PENDING_REMINDERS): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  for (const shift of shifts) {
    if (!shift.isPrimary) continue;
    const startMs = new Date(shift.start_time).getTime();
    for (const offset of REMINDER_OFFSETS_MIN) {
      const fireAt = new Date(startMs - offset * 60_000);
      if (fireAt.getTime() - now.getTime() < MIN_LEAD_MS) continue;
      planned.push({
        identifier: reminderId(shift.id, offset, startMs),
        fireAt,
        title: "Shift reminder",
        body: `Your ${shift.desk_label} shift begins in ${offset} minutes.`,
        shiftId: shift.id,
      });
    }
  }
  planned.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return planned.slice(0, max);
}

export function diffReminders(planned: PlannedReminder[], existingIds: string[]) {
  const wanted = new Set(planned.map((p) => p.identifier));
  const existing = new Set(existingIds.filter((id) => id.startsWith(REMINDER_PREFIX)));
  return {
    toCancel: [...existing].filter((id) => !wanted.has(id)),
    toSchedule: planned.filter((p) => !existing.has(p.identifier)),
  };
}
