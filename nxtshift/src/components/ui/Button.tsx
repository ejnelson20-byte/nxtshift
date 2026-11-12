import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type PressableProps } from "react-native";
import { haptics } from "@/lib/haptics";
import { colors } from "@/theme/tokens";

type Variant = "primary" | "critical" | "secondary" | "ghost";

type Props = Omit<PressableProps, "children"> & {
  label: string;
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
  size?: "md" | "lg";
  haptic?: "tap" | "press" | "heavy" | "none";
};

const variantClass: Record<Variant, string> = {
  primary: "bg-accent",
  critical: "bg-critical",
  secondary: "bg-elevated border border-border",
  ghost: "bg-transparent",
};

const labelClass: Record<Variant, string> = {
  primary: "text-bg",
  critical: "text-text",
  secondary: "text-text",
  ghost: "text-accent",
};

export function Button({
  label,
  variant = "primary",
  loading = false,
  icon,
  size = "md",
  haptic = "tap",
  disabled,
  onPress,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rest.accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={6}
      onPress={(e) => {
        if (haptic !== "none") haptics[haptic]();
        onPress?.(e);
      }}
      className={`flex-row items-center justify-center rounded-2xl px-5 ${size === "lg" ? "min-h-14" : "min-h-12"} ${variantClass[variant]} ${
        isDisabled ? "opacity-40" : "active:opacity-80"
      }`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.bg : colors.text} />
      ) : (
        <View className="flex-row items-center gap-2">
          {icon}
          <Text className={`text-base font-bold tracking-wide ${labelClass[variant]}`}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}
