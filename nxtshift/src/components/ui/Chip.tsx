import { Pressable, Text } from "react-native";
import { haptics } from "@/lib/haptics";

export function Chip({
  label,
  selected,
  onPress,
  accessibilityHint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      hitSlop={4}
      className={`min-h-11 justify-center rounded-full border px-4 ${selected ? "border-accent bg-accent/15" : "border-border bg-bg-secondary"}`}
    >
      <Text className={`text-sm font-semibold ${selected ? "text-accent" : "text-muted"}`}>{label}</Text>
    </Pressable>
  );
}
