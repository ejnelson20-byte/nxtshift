import { RadioTower } from "lucide-react-native";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { colors } from "@/theme/tokens";

type Props = { onPress: () => void; disabled: boolean; loading: boolean; urgent: boolean; hint: string };

/** The dominant action on the Desk screen. Restrained pulse; none with Reduce Motion. */
export function PingButton({ onPress, disabled, loading, urgent, hint }: Props) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || disabled) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false);
  }, [disabled, pulse, reduceMotion]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.08 }],
  }));

  const tint = urgent ? colors.critical : colors.accent;

  return (
    <View className="items-center justify-center py-2">
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: 8,
            bottom: 8,
            left: 0,
            right: 0,
            borderRadius: 28,
            borderWidth: 2,
            borderColor: tint,
          },
          ring,
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ping active desk"
        accessibilityHint={hint}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        disabled={disabled || loading}
        onPress={() => {
          haptics.heavy();
          onPress();
        }}
        style={{ backgroundColor: tint }}
        className={`min-h-[132px] w-full items-center justify-center gap-3 rounded-[28px] ${disabled ? "opacity-40" : "active:opacity-85"}`}
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.bg} />
        ) : (
          <>
            <RadioTower color={colors.bg} size={40} strokeWidth={2.25} />
            <Text className="text-2xl font-extrabold tracking-[2px] text-bg">PING ACTIVE DESK</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}
