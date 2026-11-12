import type { ReactNode } from "react";
import { Text, View, type ViewProps } from "react-native";

type CardProps = ViewProps & {
  children: ReactNode;
  tone?: "default" | "elevated" | "critical" | "warning" | "success";
};

const toneClass: Record<NonNullable<CardProps["tone"]>, string> = {
  default: "bg-card border-border",
  elevated: "bg-elevated border-border",
  critical: "bg-card border-critical/60",
  warning: "bg-card border-warning/60",
  success: "bg-card border-success/50",
};

export function Card({ children, tone = "default", className, ...rest }: CardProps) {
  return (
    <View className={`rounded-card border p-4 ${toneClass[tone]} ${className ?? ""}`} {...rest}>
      {children}
    </View>
  );
}

export function SectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-end justify-between">
      <View className="flex-1 pr-3">
        <Text accessibilityRole="header" className="text-xs font-bold tracking-[2px] text-muted">
          {title}
        </Text>
        {subtitle ? <Text className="mt-1 text-sm text-muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function ScreenTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-start justify-between pt-2">
      <View className="flex-1 pr-3">
        <Text accessibilityRole="header" className="text-[28px] font-extrabold tracking-tight text-text">
          {title}
        </Text>
        {subtitle ? <Text className="mt-1 text-base text-muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}
