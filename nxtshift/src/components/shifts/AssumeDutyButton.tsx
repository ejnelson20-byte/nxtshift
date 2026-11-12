import { ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { canAssumeDuty, CHECK_IN_WINDOW_MS } from "@/features/shifts/api";
import { useAssumeDuty } from "@/features/shifts/hooks";
import { useNow } from "@/hooks/use-now";
import { userMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { colors } from "@/theme/tokens";
import type { Shift } from "@/types/domain";
import { formatTime } from "@/utils/time";

export function AssumeDutyButton({ shift, memberId, timeZone }: { shift: Shift; memberId: string; timeZone: string }) {
  const now = useNow(15_000);
  const assume = useAssumeDuty();

  if (shift.assigned_member_id !== memberId) return null;
  if (shift.is_checked_in) {
    return (
      <View className="flex-row items-center gap-2 rounded-2xl border border-success/40 bg-success/10 px-4 py-3">
        <ShieldCheck color={colors.success} size={20} />
        <Text className="text-base font-semibold text-success">On duty — checked in</Text>
      </View>
    );
  }

  const enabled = canAssumeDuty(shift, memberId, now);
  const opensAt = new Date(new Date(shift.start_time).getTime() - CHECK_IN_WINDOW_MS);
  return (
    <View className="gap-2">
      <Button
        label="ASSUME DUTY"
        size="lg"
        haptic="press"
        disabled={!enabled}
        loading={assume.isPending}
        accessibilityHint={
          enabled ? "Checks you in and relieves the previous shift" : `Available from ${formatTime(opensAt, timeZone)}`
        }
        onPress={() =>
          assume.mutate(shift.id, {
            onSuccess: () => haptics.success(),
            onError: () => haptics.error(),
          })
        }
      />
      {!enabled ? (
        <Text className="text-center text-xs text-muted">
          Opens at {formatTime(opensAt, timeZone)} (15 minutes before start)
        </Text>
      ) : null}
      {assume.error ? (
        <Text accessibilityRole="alert" className="text-center text-sm text-critical">
          {userMessage(assume.error)}
        </Text>
      ) : null}
    </View>
  );
}
