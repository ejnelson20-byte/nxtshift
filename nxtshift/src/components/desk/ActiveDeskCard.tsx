import { Pressable, Text, View } from "react-native";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { haptics } from "@/lib/haptics";
import type { DeskStatus } from "@/types/domain";
import { formatTime } from "@/utils/time";

const statusBadge = (s: DeskStatus["status"]) =>
  s === "checked_in" ? (
    <Badge label="CHECKED IN" tone="success" dot />
  ) : (
    <Badge label="AWAITING RELIEF" tone="warning" dot />
  );

type Props = {
  desks: DeskStatus[];
  selected: string | null;
  onSelect: (desk: string) => void;
  timeZone: string;
};

/** Shows desk labels and coarse status only — never who is on duty. */
export function ActiveDeskCard({ desks, selected, onSelect, timeZone }: Props) {
  if (desks.length === 0) {
    return (
      <Card accessibilityLabel="Active desk: no active shift">
        <Text className="text-xs font-bold tracking-[2px] text-muted">ACTIVE DESK</Text>
        <Text className="mt-2 text-2xl font-bold text-text">No active shift</Text>
        <View className="mt-3">
          <Badge label="NO ACTIVE SHIFT" tone="muted" dot />
        </View>
        <Text className="mt-3 text-sm text-muted">Pings can&apos;t be routed until a desk shift is active.</Text>
      </Card>
    );
  }

  if (desks.length === 1) {
    const d = desks[0]!;
    return (
      <Card
        accessibilityLabel={`Active desk: ${d.desk_label}, ${d.status === "checked_in" ? "checked in" : "awaiting relief"}`}
      >
        <Text className="text-xs font-bold tracking-[2px] text-muted">ACTIVE DESK</Text>
        <Text className="mt-2 text-2xl font-bold text-text">{d.desk_label}</Text>
        <View className="mt-3 flex-row items-center justify-between">
          {statusBadge(d.status)}
          <Text className="text-sm text-muted">until {formatTime(d.ends_at, timeZone)}</Text>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <Text className="text-xs font-bold tracking-[2px] text-muted">ACTIVE DESKS · CHOOSE ONE</Text>
      <View accessibilityRole="radiogroup" className="mt-3 gap-2">
        {desks.map((d) => {
          const isSelected = selected === d.desk_label;
          return (
            <Pressable
              key={d.desk_label}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${d.desk_label}, ${d.status === "checked_in" ? "checked in" : "awaiting relief"}`}
              onPress={() => {
                haptics.tap();
                onSelect(d.desk_label);
              }}
              className={`min-h-14 flex-row items-center justify-between rounded-2xl border px-4 ${
                isSelected ? "border-accent bg-accent/10" : "border-border bg-bg-secondary"
              }`}
            >
              <Text className="text-lg font-semibold text-text">{d.desk_label}</Text>
              {statusBadge(d.status)}
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}
