import { ScrollView, Text, View } from "react-native";
import { Chip } from "@/components/ui/Chip";
import type { LeadMember } from "@/types/domain";

/** Horizontal chip selector for a workspace member (or none). */
export function MemberPicker({
  label,
  members,
  value,
  onChange,
  excludeId,
  error,
}: {
  label: string;
  members: LeadMember[];
  value: string | null;
  onChange: (id: string | null) => void;
  excludeId?: string | null;
  error?: string;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs font-bold tracking-[1.5px] text-muted">{label.toUpperCase()}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        <Chip label="None" selected={value === null} onPress={() => onChange(null)} />
        {members
          .filter((m) => m.id !== excludeId)
          .map((m) => (
            <Chip
              key={m.id}
              label={m.has_device ? m.callsign : `${m.callsign} · no device`}
              selected={value === m.id}
              onPress={() => onChange(m.id)}
              accessibilityHint={
                m.has_device ? undefined : "This member has no registered device and won't receive pushes"
              }
            />
          ))}
      </ScrollView>
      {error ? <Text className="text-sm text-critical">{error}</Text> : null}
    </View>
  );
}
