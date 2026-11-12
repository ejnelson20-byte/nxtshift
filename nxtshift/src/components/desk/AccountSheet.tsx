import { useMutation } from "@tanstack/react-query";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { leaveAndSignOut } from "@/features/auth/auth-service";
import { registerForPush } from "@/features/notifications/registration";
import { userMessage } from "@/lib/errors";
import { useSessionStore } from "@/stores/session-store";

export function AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const profile = useSessionStore((s) => s.profile);
  const insets = useSafeAreaInsets();
  const leave = useMutation({ mutationFn: leaveAndSignOut, onSuccess: onClose });
  const push = useMutation({ mutationFn: () => registerForPush({ prompt: true }) });

  if (!profile) return null;
  const pushCopy: Record<string, string> = {
    registered: "This device will receive desk notifications.",
    denied: "Notifications are off. Enable them in system Settings to receive pings.",
    simulator: "Push notifications require a physical device.",
    unconfigured: "Push isn't configured in this build (missing EAS project ID).",
    failed: "Couldn't register this device. Try again.",
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
      <Pressable accessibilityLabel="Close account sheet" className="flex-1 bg-black/60" onPress={onClose} />
      <View
        style={{ paddingBottom: insets.bottom + 16 }}
        className="gap-4 rounded-t-3xl border-t border-border bg-bg-secondary px-5 pt-5"
      >
        <View className="h-1 w-10 self-center rounded-full bg-border" />
        <Text accessibilityRole="header" className="text-2xl font-extrabold text-text">
          {profile.callsign}
        </Text>
        <Text className="text-base text-muted">
          {profile.role.toUpperCase()} · {profile.workspace.name}
        </Text>

        <View className="gap-2 rounded-2xl border border-border bg-card p-4">
          <Text className="text-sm font-semibold text-text">Notifications</Text>
          <Text className="text-sm text-muted">
            {push.data ? pushCopy[push.data] : profile.has_push_token ? pushCopy.registered : "Not registered yet."}
          </Text>
          <Button
            label="Re-register this device"
            variant="secondary"
            loading={push.isPending}
            onPress={() => push.mutate()}
          />
        </View>

        <View className="gap-2 rounded-2xl border border-critical/40 bg-card p-4">
          <Text className="text-sm font-semibold text-text">Leave workspace</Text>
          <Text className="text-sm text-muted">
            Your anonymous membership is deleted and this device stops receiving pings. You&apos;ll need a new invite
            code to rejoin.
          </Text>
          {leave.error ? <Text className="text-sm text-critical">{userMessage(leave.error)}</Text> : null}
          <Button
            label="Sign out & leave"
            variant="critical"
            haptic="heavy"
            loading={leave.isPending}
            onPress={() => leave.mutate()}
          />
        </View>
        <Button label="Close" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}
