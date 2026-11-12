import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const PING_CATEGORY = "NXTSHIFT_PING";
export const ACKNOWLEDGE_ACTION = "ACKNOWLEDGE";

// Foreground presentation: show urgent pings as banners even while open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let configured: Promise<void> | null = null;

export function configureNotifications(): Promise<void> {
  configured ??= (async () => {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("urgent", {
        name: "Urgent desk requests",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 400, 200, 400],
        sound: "default",
        // Hide content on the lock screen; pings show generic text anyway.
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.setNotificationChannelAsync("default", {
        name: "Desk requests & alerts",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.setNotificationChannelAsync("reminders", {
        name: "Shift reminders",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
      });
    }
    // The action opens the app so the acknowledgment request runs with a
    // restored session; iOS does not guarantee JS execution for background
    // actions when the app has been terminated.
    await Notifications.setNotificationCategoryAsync(PING_CATEGORY, [
      { identifier: ACKNOWLEDGE_ACTION, buttonTitle: "Acknowledge", options: { opensAppToForeground: true } },
    ]);
  })().catch((error: unknown) => {
    configured = null;
    throw error;
  });
  return configured;
}
