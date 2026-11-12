import { Text, View } from "react-native";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { useAcknowledgePing } from "@/features/desk/hooks";
import { presetLabel } from "@/features/desk/presets";
import { useOpenPings } from "@/features/lead/hooks";
import { useNow } from "@/hooks/use-now";
import { userMessage } from "@/lib/errors";
import type { OpenPing } from "@/types/domain";
import { relativeTime } from "@/utils/time";

function OpenPingRow({ ping, now }: { ping: OpenPing; now: number }) {
  const ack = useAcknowledgePing();
  const urgent = ping.category === "urgent_desk";
  return (
    <Card tone={urgent ? "critical" : "default"} className="gap-2">
      <View className="flex-row flex-wrap items-center gap-2">
        <Badge label={urgent ? "URGENT" : "REQUEST"} tone={urgent ? "critical" : "accent"} />
        {ping.escalated_at ? <Badge label="ESCALATED" tone="warning" /> : null}
        <Text className="text-xs text-muted">
          {ping.desk_label} · {relativeTime(ping.created_at, now)}
        </Text>
      </View>
      <Text className="text-base font-semibold text-text">{presetLabel(ping.preset)}</Text>
      {ping.message ? <Text className="text-sm text-text">“{ping.message}”</Text> : null}
      {ack.error ? <Text className="text-sm text-critical">{userMessage(ack.error)}</Text> : null}
      <Button label="Acknowledge" variant="secondary" loading={ack.isPending} onPress={() => ack.mutate(ping.id)} />
    </Card>
  );
}

export function OpenPings() {
  const pings = useOpenPings();
  const now = useNow(30_000);
  const list = pings.data ?? [];
  return (
    <View className="gap-3">
      <SectionHeader title="OPEN REQUESTS" subtitle="Unacknowledged desk requests in the last 24 hours" />
      {list.length === 0 ? (
        <Text className="text-sm text-muted">
          {pings.isLoading ? "Loading…" : "Nothing waiting. All requests acknowledged."}
        </Text>
      ) : (
        list.map((p) => <OpenPingRow key={p.id} ping={p} now={now} />)
      )}
    </View>
  );
}
