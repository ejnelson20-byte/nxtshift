import * as Notifications from "expo-notifications";
import { diffReminders, MAX_PENDING_REMINDERS, planReminders, reminderId } from "@/features/shifts/reminders";
import { cancelShiftReminders, reconcileShiftReminders } from "@/features/shifts/reminder-sync";

const now = new Date("2030-01-01T10:00:00Z");
const at = (iso: string) => new Date(iso).toISOString();
const shift = (id: string, start: string, isPrimary = true) => ({
  id,
  desk_label: "Front Desk",
  start_time: at(start),
  isPrimary,
});

describe("planReminders", () => {
  it("schedules 60/30/15 minute reminders for primary shifts only", () => {
    const plan = planReminders([shift("a", "2030-01-01T18:00:00Z"), shift("b", "2030-01-01T20:00:00Z", false)], now);
    expect(plan.map((p) => p.fireAt.toISOString())).toEqual([
      "2030-01-01T17:00:00.000Z",
      "2030-01-01T17:30:00.000Z",
      "2030-01-01T17:45:00.000Z",
    ]);
    expect(plan[1]!.body).toBe("Your Front Desk shift begins in 30 minutes.");
  });

  it("skips reminders whose time has passed", () => {
    const plan = planReminders([shift("a", "2030-01-01T10:20:00Z")], now);
    expect(plan.map((p) => p.identifier)).toEqual([reminderId("a", 15, Date.parse("2030-01-01T10:20:00Z"))]);
  });

  it("respects the platform pending-notification budget, keeping the soonest", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      shift(`s${i}`, new Date(now.getTime() + (i + 2) * 3600_000).toISOString()),
    );
    const plan = planReminders(many, now);
    expect(plan).toHaveLength(MAX_PENDING_REMINDERS);
    expect(plan[0]!.shiftId).toBe("s0");
  });
});

describe("diffReminders", () => {
  it("replaces modified shifts, cancels removed ones and ignores unrelated notifications", () => {
    const original = planReminders([shift("a", "2030-01-01T18:00:00Z"), shift("b", "2030-01-01T20:00:00Z")], now);
    const existing = [...original.map((p) => p.identifier), "some-other-app-notification"];
    // Shift a moved one hour later; shift b removed; shift c added.
    const updated = planReminders([shift("a", "2030-01-01T19:00:00Z"), shift("c", "2030-01-01T21:00:00Z")], now);
    const { toCancel, toSchedule } = diffReminders(updated, existing);
    expect(toCancel).toHaveLength(6);
    expect(toCancel).not.toContain("some-other-app-notification");
    expect(toSchedule).toHaveLength(6);
  });

  it("is a no-op when nothing changed (no duplicates)", () => {
    const plan = planReminders([shift("a", "2030-01-01T18:00:00Z")], now);
    expect(
      diffReminders(
        plan,
        plan.map((p) => p.identifier),
      ),
    ).toEqual({ toCancel: [], toSchedule: [] });
  });
});

describe("reconcileShiftReminders", () => {
  beforeEach(async () => {
    await cancelShiftReminders();
    jest.clearAllMocks();
  });

  it("does not create duplicates when triggered repeatedly (launch + resume + data change)", async () => {
    const soon = new Date(Date.now() + 3 * 3600_000).toISOString();
    const shifts = [{ id: "x", desk_label: "North Desk", start_time: soon, isPrimary: true }];
    await Promise.all([
      reconcileShiftReminders(shifts),
      reconcileShiftReminders(shifts),
      reconcileShiftReminders(shifts),
    ]);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(3);
    const all = await Notifications.getAllScheduledNotificationsAsync();
    expect(all).toHaveLength(3);
  });

  it("removes all reminders on sign-out", async () => {
    const soon = new Date(Date.now() + 3 * 3600_000).toISOString();
    await reconcileShiftReminders([{ id: "y", desk_label: "Desk", start_time: soon, isPrimary: true }]);
    await cancelShiftReminders();
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
  });

  it("schedules nothing without notification permission", async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
    await reconcileShiftReminders([
      { id: "z", desk_label: "Desk", start_time: new Date(Date.now() + 7200_000).toISOString(), isPrimary: true },
    ]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
