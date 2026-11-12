import * as Notifications from "expo-notifications";
import { diffReminders, planReminders, REMINDER_PREFIX, type ReminderShift } from "./reminders";

let inFlight: Promise<void> | null = null;

/**
 * Reconcile scheduled reminders with the latest shift list. Serialized so
 * overlapping triggers (launch + resume + data change) can't double-schedule.
 */
export function reconcileShiftReminders(shifts: ReminderShift[]): Promise<void> {
  const run = async () => {
    const permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) return;
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    const { toCancel, toSchedule } = diffReminders(
      planReminders(shifts, new Date()),
      existing.map((n) => n.identifier),
    );
    await Promise.all(toCancel.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
    for (const r of toSchedule) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.identifier,
        content: {
          title: r.title,
          body: r.body,
          data: { type: "shift_reminder", shift_id: r.shiftId },
          sound: "default",
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.fireAt, channelId: "reminders" },
      });
    }
  };
  const next = (inFlight ?? Promise.resolve()).then(run, run);
  inFlight = next.catch(() => undefined);
  return next;
}

export async function cancelShiftReminders(): Promise<void> {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter((n) => n.identifier.startsWith(REMINDER_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}
