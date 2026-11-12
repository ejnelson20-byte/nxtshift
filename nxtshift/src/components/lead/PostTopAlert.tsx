import { zodResolver } from "@hookform/resolvers/zod";
import { useRef } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/TextField";
import { usePublishTopAlert } from "@/features/lead/hooks";
import { userMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { newRequestId } from "@/lib/ids";
import { topAlertSchema, type TopAlertForm } from "@/lib/validation";
import { priorityColor } from "@/theme/tokens";

const PRIORITIES = [
  { id: "normal", label: "Info" },
  { id: "high", label: "Priority" },
  { id: "critical", label: "Critical" },
] as const;

export function PostTopAlert() {
  const publish = usePublishTopAlert();
  const requestId = useRef<string | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<TopAlertForm>({
    resolver: zodResolver(topAlertSchema),
    defaultValues: { message: "", priority: "normal" },
  });
  const message = useWatch({ control, name: "message" });
  const priority = useWatch({ control, name: "priority" });

  const submit = (v: TopAlertForm) => {
    requestId.current ??= newRequestId();
    publish.mutate(
      { message: v.message, priority: v.priority, clientRequestId: requestId.current },
      {
        onSuccess: () => {
          haptics.success();
          requestId.current = null;
          reset();
        },
        onError: () => haptics.error(),
      },
    );
  };

  return (
    <View className="gap-3">
      <SectionHeader title="POST TOP ALERT" subtitle="Visible to everyone in the workspace for 24 hours." />
      <Card className="gap-4">
        <Controller
          control={control}
          name="message"
          render={({ field }) => (
            <TextField
              label="Announcement"
              multiline
              textAlignVertical="top"
              className="min-h-24"
              maxLength={280}
              value={field.value}
              onChangeText={(t) => {
                field.onChange(t);
                requestId.current = null;
              }}
              hint={`${field.value.length}/280 · Push notifications show generic text; the message is shown in-app.`}
              error={formState.errors.message?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="priority"
          render={({ field }) => (
            <View accessibilityRole="radiogroup" accessibilityLabel="Priority" className="flex-row gap-2">
              {PRIORITIES.map((p) => (
                <Chip key={p.id} label={p.label} selected={field.value === p.id} onPress={() => field.onChange(p.id)} />
              ))}
            </View>
          )}
        />
        <View accessibilityLabel="Preview" className="gap-1 rounded-2xl border border-dashed border-border p-3">
          <Text className="text-[10px] font-bold tracking-[1.5px] text-muted">PREVIEW</Text>
          <Text style={{ color: priorityColor[priority] }} className="text-[11px] font-bold tracking-[1.5px]">
            {PRIORITIES.find((p) => p.id === priority)?.label.toUpperCase()}
          </Text>
          <Text className="text-base text-text">{message.trim() || "Your announcement appears here."}</Text>
        </View>
        {publish.data ? (
          <Text className="text-sm text-success">
            Published. Notifications queued for {publish.data.recipients_queued} device(s).
          </Text>
        ) : null}
        {publish.error ? <Text className="text-sm text-critical">{userMessage(publish.error)}</Text> : null}
        <Button
          label="PUBLISH ALERT"
          variant={priority === "critical" ? "critical" : "primary"}
          haptic="press"
          loading={publish.isPending}
          onPress={() => void handleSubmit(submit)()}
        />
      </Card>
    </View>
  );
}
