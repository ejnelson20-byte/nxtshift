import { Text, View } from "react-native";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import type { LeadSummary } from "@/types/domain";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "warning" | "critical" | "muted";
}) {
  const color = { accent: "text-accent", warning: "text-warning", critical: "text-critical", muted: "text-text" }[tone];
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      className="min-h-24 grow basis-[46%] justify-between rounded-card border border-border bg-card p-4"
    >
      <Text className="text-xs font-bold tracking-[1.5px] text-muted">{label.toUpperCase()}</Text>
      <Text className={`text-4xl font-extrabold ${value > 0 ? color : "text-text"}`}>{value}</Text>
    </View>
  );
}

export function SummaryGrid({
  data,
  isLoading,
  error,
  onRetry,
}: {
  data?: LeadSummary;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (isLoading) return <CardSkeleton lines={3} />;
  if (!data) return error ? <ErrorState error={error} onRetry={onRetry} /> : null;
  return (
    <View className="flex-row flex-wrap gap-3">
      <Stat label="Active shifts" value={data.active_shifts} tone="accent" />
      <Stat label="Upcoming (24h)" value={data.upcoming_shifts} tone="muted" />
      <Stat label="Awaiting relief" value={data.awaiting_relief} tone="warning" />
      <Stat label="Unacked urgent" value={data.unacknowledged_urgent} tone="critical" />
    </View>
  );
}
