import type { ComponentRef, Ref } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import { colors } from "@/theme/tokens";

type Props = TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
  ref?: Ref<ComponentRef<typeof TextInput>>;
};

export function TextField({ label, error, hint, className, ref, ...rest }: Props) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs font-bold tracking-[1.5px] text-muted">{label.toUpperCase()}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        className={`min-h-12 rounded-xl border bg-bg-secondary px-4 py-3 text-base text-text ${
          error ? "border-critical" : "border-border"
        } ${className ?? ""}`}
        {...rest}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-critical">
          {error}
        </Text>
      ) : hint ? (
        <Text className="text-sm text-muted">{hint}</Text>
      ) : null}
    </View>
  );
}
