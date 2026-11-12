import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { envResult } from "@/lib/env";
import { rpc } from "@/services/api";

export type RegistrationResult = "registered" | "denied" | "simulator" | "unconfigured" | "failed";

function projectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? (envResult.ok ? envResult.env.easProjectId : undefined);
}

/**
 * Request permission (if needed), obtain the Expo push token and register it
 * server-side. Safe to call repeatedly; the server ignores unchanged tokens.
 */
export async function registerForPush(options: { prompt: boolean }): Promise<RegistrationResult> {
  if (!Device.isDevice) return "simulator";
  const id = projectId();
  if (!id) return "unconfigured";

  let permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted && options.prompt && permissions.canAskAgain) {
    permissions = await Notifications.requestPermissionsAsync();
  }
  if (!permissions.granted) return "denied";

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await rpc("register_push_token", { p_token: token.data });
    return "registered";
  } catch {
    return "failed";
  }
}

/** Re-register when the OS rotates the device token. */
export function watchPushTokenChanges(): () => void {
  const sub = Notifications.addPushTokenListener(() => {
    void registerForPush({ prompt: false });
  });
  return () => sub.remove();
}
