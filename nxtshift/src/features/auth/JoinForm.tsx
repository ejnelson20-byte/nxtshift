import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { type ComponentRef, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { Text, type TextInput, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { userMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { joinSchema, type JoinForm as JoinFormValues } from "@/lib/validation";
import { joinWorkspace } from "./auth-service";
import { registerForPush } from "@/features/notifications/registration";

type TextInputRef = ComponentRef<typeof TextInput>;

export function JoinForm({ onJoined }: { onJoined: () => void }) {
  const callsignRef = useRef<TextInputRef>(null);
  const { control, handleSubmit, formState } = useForm<
    JoinFormValues,
    unknown,
    { inviteCode: string; callsign: string }
  >({
    resolver: zodResolver(joinSchema),
    defaultValues: { inviteCode: "", callsign: "" },
    mode: "onSubmit",
  });

  const join = useMutation({
    mutationFn: (v: { inviteCode: string; callsign: string }) => joinWorkspace(v.inviteCode, v.callsign),
    onSuccess: () => {
      haptics.success();
      // Ask for notification permission in context, right after joining.
      void registerForPush({ prompt: true });
      onJoined();
    },
    onError: () => haptics.error(),
  });

  return (
    <View className="gap-5">
      <Controller
        control={control}
        name="inviteCode"
        render={({ field }) => (
          <TextField
            label="Invite code"
            placeholder="R7K2Q9"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={6}
            returnKeyType="next"
            className="font-mono text-2xl tracking-[6px]"
            value={field.value}
            onChangeText={(t) => field.onChange(t.toUpperCase())}
            onBlur={field.onBlur}
            onSubmitEditing={() => callsignRef.current?.focus()}
            error={formState.errors.inviteCode?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="callsign"
        render={({ field }) => (
          <TextField
            ref={callsignRef}
            label="Callsign"
            placeholder="Runner_Alpha"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            maxLength={24}
            returnKeyType="go"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            onSubmitEditing={() => void handleSubmit((v) => join.mutate(v))()}
            hint="Anonymous. Avoid your real name or room number."
            error={formState.errors.callsign?.message}
          />
        )}
      />
      {join.error ? (
        <Text
          accessibilityRole="alert"
          className="rounded-xl border border-critical/50 bg-critical/10 p-3 text-base text-text"
        >
          {userMessage(join.error)}
        </Text>
      ) : null}
      <Button
        label="JOIN"
        size="lg"
        haptic="press"
        loading={join.isPending}
        onPress={() => void handleSubmit((v) => join.mutate(v))()}
      />
      <Text className="text-center text-xs leading-5 text-muted">
        Your access is tied to this device. Uninstalling the app or signing out permanently removes it — you&apos;ll
        need a new invite to rejoin.
      </Text>
    </View>
  );
}
