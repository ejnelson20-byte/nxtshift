import { router } from "expo-router";
import { Radio, ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { useSessionStore } from "@/stores/session-store";
import { colors } from "@/theme/tokens";

export default function Welcome() {
  const reason = useSessionStore((s) => s.signedOutReason);
  const reduceMotion = useReducedMotion();
  const enter = (delay: number) => (reduceMotion ? undefined : FadeInDown.delay(delay).duration(500));

  return (
    <SafeAreaView className="flex-1 bg-bg px-6">
      <View className="flex-1 justify-center">
        <Animated.View entering={enter(0)}>
          <View className="mb-8 h-16 w-16 items-center justify-center rounded-3xl border border-accent/40 bg-accent/10">
            <Radio color={colors.accent} size={32} />
          </View>
        </Animated.View>
        <Animated.View entering={enter(80)}>
          <Text accessibilityRole="header" className="text-5xl font-extrabold tracking-tight text-text">
            nxtshift
          </Text>
          <Text className="mt-3 text-xl text-muted">Your desk. Your shift. Always connected.</Text>
        </Animated.View>

        {reason ? (
          <View accessibilityRole="alert" className="mt-8 rounded-2xl border border-warning/50 bg-warning/10 p-4">
            <Text className="text-base text-text">
              {reason === "expired"
                ? "Your anonymous session expired and can't be recovered. Join again with your workspace invite code."
                : "Your membership was removed by a workspace admin. Ask your lead for a new invite."}
            </Text>
          </View>
        ) : null}
      </View>

      <Animated.View entering={enter(160)}>
        <View className="gap-4 pb-6">
          <View className="flex-row items-start gap-3 rounded-2xl border border-border bg-card p-4">
            <ShieldCheck color={colors.success} size={20} />
            <Text className="flex-1 text-sm leading-5 text-muted">
              No name, email or phone number. You&apos;re identified only by an anonymous callsign you choose.
            </Text>
          </View>
          <Button label="JOIN WORKSPACE" size="lg" haptic="press" onPress={() => router.push("/(auth)/join")} />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}
