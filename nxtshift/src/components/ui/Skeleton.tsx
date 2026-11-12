import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/** Shimmer placeholder; static when the OS "reduce motion" setting is on. */
export function Skeleton({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    if (!reduceMotion) opacity.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [opacity, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={style}>
      <View className={`rounded-xl bg-elevated ${className ?? "h-5 w-full"}`} />
    </Animated.View>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <View accessibilityLabel="Loading" className="gap-3 rounded-card border border-border bg-card p-4">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-5 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </View>
  );
}
