import { Redirect } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { envResult } from "@/lib/env";
import { useSessionStore } from "@/stores/session-store";
import { colors } from "@/theme/tokens";

/** Entry gate: routes by session state once secure storage is restored. */
export default function Index() {
  const status = useSessionStore((s) => s.status);

  if (status === "unconfigured") {
    return (
      <View className="flex-1 justify-center gap-3 bg-bg px-8">
        <Text className="text-2xl font-extrabold text-text">Configuration required</Text>
        <Text className="text-base text-muted">
          This build is missing its Supabase configuration. Set the EXPO_PUBLIC_* variables described in .env.example
          and rebuild.
        </Text>
        {!envResult.ok
          ? envResult.issues.map((i) => (
              <Text key={i} className="font-mono text-sm text-warning">
                {i}
              </Text>
            ))
          : null}
      </View>
    );
  }
  if (status === "booting") {
    return (
      <View accessibilityLabel="Loading nxtshift" className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <Redirect href={status === "ready" ? "/(tabs)" : "/(auth)/welcome"} />;
}
