import { Megaphone } from "lucide-react-native";
import { Text, View } from "react-native";
import { Card, SectionHeader } from "@/components/ui/Card";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useNow } from "@/hooks/use-now";
import { colors, priorityColor } from "@/theme/tokens";
import type { TopAlert } from "@/types/domain";
import { relativeTime, remainingValidity } from "@/utils/time";

const priorityLabel = { normal: "INFO", high: "PRIORITY", critical: "CRITICAL" } as const;

function AlertCard({ alert, now }: { alert: TopAlert; now: number }) {
  const color = priorityColor[alert.priority];
  return (
    <Card
      tone={alert.priority === "critical" ? "critical" : alert.priority === "high" ? "warning" : "default"}
      accessibilityLabel={`${priorityLabel[alert.priority]} alert: ${alert.message}. Posted ${relativeTime(alert.created_at, now)}, ${remainingValidity(alert.created_at, now)}.`}
    >
      <View className="flex-row items-center gap-2">
        <View style={{ backgroundColor: color }} className="h-2 w-2 rounded-full" />
        <Text style={{ color }} className="text-[11px] font-bold tracking-[1.5px]">
          {priorityLabel[alert.priority]}
        </Text>
      </View>
      <Text className="mt-2 text-base leading-6 text-text">{alert.message}</Text>
      <Text className="mt-2 text-xs text-muted">
        {relativeTime(alert.created_at, now)} · {remainingValidity(alert.created_at, now)}
      </Text>
    </Card>
  );
}

export function TopAlerts({
  alerts,
  isLoading,
  error,
  onRetry,
}: {
  alerts: TopAlert[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const now = useNow(60_000);
  return (
    <View className="gap-3">
      <SectionHeader title="TOP ALERTS" />
      {isLoading ? (
        <CardSkeleton lines={2} />
      ) : error && !alerts ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : !alerts || alerts.length === 0 ? (
        <EmptyState
          title="No active alerts"
          message="Announcements from leads appear here for 24 hours."
          icon={<Megaphone color={colors.muted} size={26} />}
        />
      ) : (
        alerts.slice(0, 3).map((a) => <AlertCard key={a.id} alert={a} now={now} />)
      )}
    </View>
  );
}
