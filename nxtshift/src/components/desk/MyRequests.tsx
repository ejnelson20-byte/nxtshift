import { Text, View } from "react-native";
import { Badge } from "@/components/ui/Badge";
import { Card, SectionHeader } from "@/components/ui/Card";
import { presetLabel } from "@/features/desk/presets";
import { useNow } from "@/hooks/use-now";
import type { PingRow } from "@/types/domain";
import { relativeTime } from "@/utils/time";

/** Status of my recent requests as recorded by the server. */
export function MyRequests({ pings }: { pings: PingRow[] }) {
  const now = useNow(30_000);
  if (pings.length === 0) return null;
  return (
    <View className="gap-3">
      <SectionHeader title="YOUR RECENT REQUESTS" />
      <Card className="gap-3">
        {pings.map((p) => (
          <View key={p.id} className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-base font-semibold text-text" numberOfLines={1}>
                {presetLabel(p.preset)}
              </Text>
              <Text className="text-xs text-muted">{relativeTime(p.created_at, now)}</Text>
            </View>
            {p.acknowledged_at ? (
              <Badge label="ACKNOWLEDGED" tone="success" dot />
            ) : p.escalated_at ? (
              <Badge label="ESCALATED" tone="warning" dot />
            ) : (
              <Badge label="WAITING" tone="muted" dot />
            )}
          </View>
        ))}
      </Card>
    </View>
  );
}
