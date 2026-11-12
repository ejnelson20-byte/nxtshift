import { Pressable, Text, View } from "react-native";
import { PING_PRESETS } from "@/features/desk/presets";
import { haptics } from "@/lib/haptics";
import type { PingPresetId } from "@/lib/validation";

export function PresetPicker({ value, onChange }: { value: PingPresetId; onChange: (v: PingPresetId) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Request type" className="flex-row flex-wrap gap-2">
      {PING_PRESETS.map((p) => {
        const selected = p.id === value;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={p.label}
            accessibilityHint={`${p.description}${p.escalates ? " Escalates if not acknowledged within 3 minutes." : ""}`}
            onPress={() => {
              haptics.tap();
              onChange(p.id);
            }}
            className={`min-h-16 grow basis-[46%] justify-center rounded-2xl border px-3 py-2 ${
              selected
                ? p.escalates
                  ? "border-critical bg-critical/10"
                  : "border-accent bg-accent/10"
                : "border-border bg-card"
            }`}
          >
            <Text className={`text-[15px] font-semibold ${selected ? "text-text" : "text-muted"}`}>{p.label}</Text>
            {p.escalates ? (
              <Text className="mt-0.5 text-[11px] font-bold tracking-[1px] text-critical">ESCALATES</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
