import { BellRing } from "lucide-react-native";
import { Text, View } from "react-native";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { useAcknowledgePing } from "@/features/desk/hooks";
import { presetLabel } from "@/features/desk/presets";
import { useNow } from "@/hooks/use-now";
import { userMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { colors } from "@/theme/tokens";
import type { PingRow } from "@/types/domain";
import { relativeTime } from "@/utils/time";

function IncomingPing({ ping, now }: { ping: PingRow; now: number }) {
  const ack = useAcknowledgePing();
  const urgent = ping.category === "urgent_desk";
  return (
    <Card tone={urgent ? "critical" : "elevated"}>
      <View className="flex-row items-center justify-between">
        <Badge label={urgent ? "URGENT" : "REQUEST"} tone={urgent ? "critical" : "accent"} dot />
        {ping.escalated_at ? <Badge label="ESCALATED" tone="warning" /> : null}
      </View>
      <Text className="mt-2 text-lg font-bold text-text">{presetLabel(ping.preset)}</Text>
      {ping.message ? <Text className="mt-1 text-base text-text">“{ping.message}”</Text> : null}
      <Text className="mt-1 text-xs text-muted">{relativeTime(ping.created_at, now)}</Text>
      {ack.error ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-critical">
          {userMessage(ack.error)}
        </Text>
      ) : null}
      <View className="mt-3">
        <Button
          label="ACKNOWLEDGE"
          variant={urgent ? "critical" : "primary"}
          loading={ack.isPending}
          onPress={() =>
            ack.mutate(ping.id, {
              onSuccess: () => haptics.success(),
              onError: () => haptics.error(),
            })
          }
        />
      </View>
    </Card>
  );
}

/** Requests addressed to me. Rendered only when there's something to act on. */
export function IncomingPings({ pings }: { pings: PingRow[] }) {
  const now = useNow(30_000);
  if (pings.length === 0) return null;
  return (
    <View className="gap-3">
      <SectionHeader title="INCOMING REQUESTS" right={<BellRing color={colors.critical} size={18} />} />
      {pings.map((p) => (
        <IncomingPing key={p.id} ping={p} now={now} />
      ))}
    </View>
  );
}
