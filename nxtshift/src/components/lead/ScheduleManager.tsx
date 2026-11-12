import { Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useLeadShifts } from "@/features/lead/hooks";
import { colors } from "@/theme/tokens";
import type { LeadShift } from "@/types/domain";
import { addDaysIso, formatDay, formatTime, isoDateInZone, mondayOf } from "@/utils/time";
import { ShiftEditor } from "./ShiftEditor";

export function ScheduleManager({ timeZone }: { timeZone: string }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [editing, setEditing] = useState<LeadShift | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const monday = addDaysIso(mondayOf(new Date(), timeZone), weekOffset * 7);
  // Query window padded by a day either side to cover time-zone offsets.
  const from = new Date(`${addDaysIso(monday, -1)}T00:00:00Z`).toISOString();
  const to = new Date(`${addDaysIso(monday, 8)}T00:00:00Z`).toISOString();
  const shifts = useLeadShifts(from, to);

  const byDay = useMemo(() => {
    const days = new Map<string, LeadShift[]>();
    for (const s of shifts.data ?? []) {
      const day = isoDateInZone(new Date(s.start_time), timeZone);
      if (day < monday || day > addDaysIso(monday, 6)) continue;
      days.set(day, [...(days.get(day) ?? []), s]);
    }
    return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shifts.data, monday, timeZone]);

  const open = (s: LeadShift | null) => {
    setEditing(s);
    setEditorOpen(true);
  };

  return (
    <View className="gap-3">
      <SectionHeader
        title="SCHEDULE"
        subtitle={`Week of ${formatDay(`${monday}T12:00:00Z`, "UTC")}`}
        right={<Button label="Add" icon={<Plus color={colors.bg} size={18} />} onPress={() => open(null)} />}
      />
      <View className="flex-row gap-2">
        {[
          { label: "This week", v: 0 },
          { label: "Next week", v: 1 },
          { label: "In 2 weeks", v: 2 },
        ].map((w) => (
          <Chip key={w.v} label={w.label} selected={weekOffset === w.v} onPress={() => setWeekOffset(w.v)} />
        ))}
      </View>

      {shifts.isLoading ? (
        <CardSkeleton lines={4} />
      ) : shifts.error && !shifts.data ? (
        <ErrorState error={shifts.error} onRetry={() => void shifts.refetch()} />
      ) : byDay.length === 0 ? (
        <EmptyState title="No shifts this week" message="Add shifts manually or paste a schedule into Smart Import." />
      ) : (
        byDay.map(([day, list]) => (
          <Card key={day} className="gap-2">
            <Text className="text-xs font-bold tracking-[1.5px] text-muted">
              {formatDay(`${day}T12:00:00Z`, "UTC").toUpperCase()}
            </Text>
            {list.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${s.desk_label} ${formatTime(s.start_time, timeZone)} to ${formatTime(s.end_time, timeZone)}, primary ${s.assigned_callsign ?? "unassigned"}`}
                onPress={() => open(s)}
                className="min-h-14 flex-row items-center justify-between gap-3 rounded-xl border border-border bg-bg-secondary px-3 py-2 active:opacity-80"
              >
                <View className="flex-1">
                  <Text className="text-base font-semibold text-text">
                    {formatTime(s.start_time, timeZone)}–{formatTime(s.end_time, timeZone)} · {s.desk_label}
                  </Text>
                  <Text className="text-sm text-muted" numberOfLines={1}>
                    {s.assigned_callsign ?? "Unassigned"}
                    {s.backup_callsign ? ` · backup ${s.backup_callsign}` : ""}
                  </Text>
                </View>
                {s.is_checked_in ? (
                  <Badge label="ON DUTY" tone="success" dot />
                ) : !s.assigned_member_id ? (
                  <Badge label="UNSTAFFED" tone="warning" />
                ) : null}
              </Pressable>
            ))}
          </Card>
        ))
      )}
      <ShiftEditor visible={editorOpen} shift={editing} timeZone={timeZone} onClose={() => setEditorOpen(false)} />
    </View>
  );
}
