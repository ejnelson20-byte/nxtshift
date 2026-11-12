import { CheckCircle2 } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/TextField";
import { useSendDeskPing } from "@/features/desk/hooks";
import { PING_PRESETS } from "@/features/desk/presets";
import type { RouteDeskPingResponse } from "@/features/desk/api";
import { userMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { newRequestId } from "@/lib/ids";
import type { PingPresetId } from "@/lib/validation";
import { colors } from "@/theme/tokens";
import { PingButton } from "./PingButton";
import { PresetPicker } from "./PresetPicker";

function resultCopy(r: RouteDeskPingResponse): string {
  const base = "Your request has been routed to the active desk.";
  if (r.escalation === "immediate")
    return `${base} The desk has no reachable device, so backup and leads were alerted.`;
  if (r.escalation === "scheduled")
    return `${base} If it isn't acknowledged within 3 minutes, it escalates automatically.`;
  return base;
}

export function PingComposer({ activeDeskCount, deskLabel }: { activeDeskCount: number; deskLabel: string | null }) {
  const [preset, setPreset] = useState<PingPresetId>("general_request");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const send = useSendDeskPing();
  // Reused across retries of the same request so the server de-duplicates.
  const requestId = useRef<string | null>(null);

  const resetRequest = () => {
    requestId.current = null;
    send.reset();
  };

  const urgent = PING_PRESETS.find((p) => p.id === preset)?.escalates ?? false;
  const needsDesk = activeDeskCount > 1 && !deskLabel;
  const disabled = activeDeskCount === 0 || needsDesk;

  const onSend = () => {
    requestId.current ??= newRequestId();
    send.mutate(
      { preset, clientRequestId: requestId.current, deskLabel: deskLabel ?? undefined, note: note.trim() || undefined },
      {
        onSuccess: () => {
          haptics.success();
          requestId.current = null;
          setNote("");
          setShowNote(false);
        },
        onError: () => haptics.error(),
      },
    );
  };

  return (
    <View className="gap-4">
      <PingButton
        onPress={onSend}
        disabled={disabled}
        loading={send.isPending}
        urgent={urgent}
        hint={
          disabled
            ? needsDesk
              ? "Choose a desk first"
              : "No desk is active"
            : `Sends: ${PING_PRESETS.find((p) => p.id === preset)?.label}`
        }
      />

      {send.data ? (
        <Card tone="success" accessibilityRole="alert" accessibilityLiveRegion="polite">
          <View className="flex-row items-start gap-3">
            <CheckCircle2 color={colors.success} size={22} />
            <View className="flex-1 gap-1">
              <Text className="text-base font-semibold text-text">{resultCopy(send.data)}</Text>
              <Text className="text-xs text-muted">
                {send.data.dispatch === "accepted_by_push_service"
                  ? "Notification accepted by the push service. Delivery to the device isn't guaranteed — watch for acknowledgment below."
                  : "Notification queued; nxtshift will keep retrying delivery."}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}
      {send.error ? (
        <Card tone="critical" accessibilityRole="alert">
          <Text className="text-base text-text">{userMessage(send.error)}</Text>
          <Text className="mt-1 text-xs text-muted">Tap the button again to retry — duplicates are prevented.</Text>
        </Card>
      ) : null}

      <PresetPicker
        value={preset}
        onChange={(v) => {
          setPreset(v);
          resetRequest();
        }}
      />

      {showNote ? (
        <TextField
          label="Optional note"
          placeholder="e.g. Visitor at the north entrance"
          value={note}
          maxLength={140}
          onChangeText={(t) => {
            setNote(t);
            requestId.current = null;
          }}
          hint={`${note.length}/140 · Visible to the desk in-app only, never in push text. Avoid personal details.`}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowNote(true)}
          hitSlop={8}
          className="min-h-11 justify-center self-start"
        >
          <Text className="text-sm font-semibold text-accent">+ Add a note</Text>
        </Pressable>
      )}
    </View>
  );
}
