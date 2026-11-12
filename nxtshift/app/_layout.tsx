import "../global.css";
import { configureNotifications } from "@/features/notifications/setup";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Banner } from "@/components/ui/Banner";
import { useAuthBootstrap } from "@/features/auth/use-auth-bootstrap";
import { useNotificationResponses } from "@/features/notifications/use-notification-responses";
import { queryClient } from "@/lib/query-client";
import { colors } from "@/theme/tokens";

function RootNavigator() {
  useAuthBootstrap();
  useNotificationResponses();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg);
    void configureNotifications().catch(() => undefined);
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: "fade" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <Banner />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <RootNavigator />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
