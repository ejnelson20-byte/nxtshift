import { memo } from "react";
import { Text, View } from "react-native";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useNow } from "@/hooks/use-now";
import type { Shift } from "@/types/domain";
import { formatDay, formatTime } from "@/utils/time";
import { AssumeDutyButton } from "./AssumeDutyButton";
import { Countdown } from "./Countdown";

const roleOf = (s: Shift, memberId: string) => (s.assigned_member_id === memberId ? "PRIMARY" : "BACKUP");

export function NextShiftHero({ shift, memberId, timeZone }: { shift: Shift; memberId: string; timeZone: string }) {
  const now = useNow(15_000);
  const started = new Date(shift.start_time).getTime() <= now;
  return (
    <Card tone="elevated" className="gap-4 border-accent/40">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-bold tracking-[2px] text-accent">{started ? "CURRENT SHIFT" : "NEXT SHIFT"}</Text>
        <Badge label={roleOf(shift, memberId)} tone={roleOf(shift, memberId) === "PRIMARY" ? "accent" : "muted"} />
      </View>
      <View>
        <Text className="text-3xl font-extrabold text-text">{shift.desk_label}</Text>
        <Text className="mt-1 text-lg text-muted">
          {formatDay(shift.start_time, timeZone)} · {formatTime(shift.start_time, timeZone)}–
          {formatTime(shift.end_time, timeZone)}
        </Text>
      </View>
      <View>
        <Text className="text-sm text-muted">{started ? "Ends in" : "Starts in"}</Text>
        <Countdown target={started ? shift.end_time : shift.start_time} label={started ? "Ends in" : "Starts in"} />
      </View>
      <AssumeDutyButton shift={shift} memberId={memberId} timeZone={timeZone} />
    </Card>
  );
}

export const ShiftCard = memo(function ShiftCard({
  shift,
  memberId,
  timeZone,
}: {
  shift: Shift;
  memberId: string;
  timeZone: string;
}) {
  const role = roleOf(shift, memberId);
  return (
    <Card
      accessibilityLabel={`${shift.desk_label}, ${formatDay(shift.start_time, timeZone)} ${formatTime(shift.start_time, timeZone)} to ${formatTime(shift.end_time, timeZone)}, ${role.toLowerCase()}${shift.is_checked_in ? ", checked in" : ""}`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-xs font-bold tracking-[1.5px] text-muted">
            {formatDay(shift.start_time, timeZone).toUpperCase()}
          </Text>
          <Text className="mt-1 text-lg font-bold text-text">{shift.desk_label}</Text>
          <Text className="text-base text-muted" style={{ fontVariant: ["tabular-nums"] }}>
            {formatTime(shift.start_time, timeZone)}–{formatTime(shift.end_time, timeZone)}
          </Text>
        </View>
        <View className="items-end gap-2">
          <Badge label={role} tone={role === "PRIMARY" ? "accent" : "muted"} />
          {shift.is_checked_in ? <Badge label="CHECKED IN" tone="success" dot /> : null}
        </View>
      </View>
    </Card>
  );
});
