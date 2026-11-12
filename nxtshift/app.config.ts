import type { ConfigContext, ExpoConfig } from "expo/config";

// Build-time configuration. Only EXPO_PUBLIC_* values are embedded in the app
// binary; they are not secrets (the Supabase publishable/anon key is public by
// design and protected by RLS). Server secrets must never be referenced here.
const APP_VARIANT = process.env.APP_VARIANT ?? "production";
const IS_DEV = APP_VARIANT === "development";
const IS_PREVIEW = APP_VARIANT === "preview";

const bundleSuffix = IS_DEV ? ".dev" : IS_PREVIEW ? ".preview" : "";
const nameSuffix = IS_DEV ? " (Dev)" : IS_PREVIEW ? " (Preview)" : "";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `nxtshift${nameSuffix}`,
  slug: "nxtshift",
  owner: "ejnelson20",
  scheme: "nxtshift",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  backgroundColor: "#090D14",
  ios: {
    bundleIdentifier: `com.nxtshift.app${bundleSuffix}`,
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      UIBackgroundModes: ["remote-notification"],
    },
  },
  android: {
    package: `com.nxtshift.app${bundleSuffix}`,
    adaptiveIcon: { backgroundColor: "#090D14" },
    // Allow FCM credentials to be supplied per environment via EAS file secret.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    permissions: ["android.permission.POST_NOTIFICATIONS", "android.permission.VIBRATE"],
    blockedPermissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.READ_CONTACTS",
      "android.permission.RECORD_AUDIO",
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-notifications",
      {
        color: "#38BDF8",
        defaultChannel: "default",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "6d4375b5-1472-4637-8de1-00e9ccce7004" },
    appVariant: APP_VARIANT,
  },
});
