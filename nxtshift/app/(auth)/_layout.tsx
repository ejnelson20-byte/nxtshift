import { Redirect, Stack } from "expo-router";
import { useSessionStore } from "@/stores/session-store";
import { colors } from "@/theme/tokens";

export default function AuthLayout() {
  const status = useSessionStore((s) => s.status);
  if (status === "ready") return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
