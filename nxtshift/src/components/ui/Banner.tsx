import { CheckCircle2, Info, XCircle } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, Text } from "react-native";
import Animated, { FadeInUp, FadeOutUp, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBannerStore } from "@/stores/banner-store";
import { colors } from "@/theme/tokens";

/** Global transient feedback (e.g. notification-action acknowledgments). */
export function Banner() {
  const banner = useBannerStore((s) => s.banner);
  const dismiss = useBannerStore((s) => s.dismiss);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(dismiss, 5000);
    return () => clearTimeout(t);
  }, [banner, dismiss]);

  if (!banner) return null;
  const Icon = banner.tone === "success" ? CheckCircle2 : banner.tone === "error" ? XCircle : Info;
  const color = banner.tone === "success" ? colors.success : banner.tone === "error" ? colors.critical : colors.accent;
  return (
    <Animated.View
      key={banner.id}
      entering={reduceMotion ? undefined : FadeInUp}
      exiting={reduceMotion ? undefined : FadeOutUp}
      style={{ position: "absolute", top: insets.top + 8, left: 16, right: 16, zIndex: 100 }}
    >
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        onPress={dismiss}
        className="flex-row items-center gap-3 rounded-2xl border border-border bg-elevated px-4 py-3"
      >
        <Icon color={color} size={20} />
        <Text className="flex-1 text-base text-text">{banner.message}</Text>
      </Pressable>
    </Animated.View>
  );
}
