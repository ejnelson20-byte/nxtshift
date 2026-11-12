import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/TextField";
import { useDeleteShift, useLeadMembers, useUpsertShift } from "@/features/lead/hooks";
import { userMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { normalizeTime, shiftFormSchema, type ShiftForm } from "@/lib/validation";
import type { LeadShift } from "@/types/domain";
import { addDaysIso, formatDay, hhmmInZone, isoDateInZone } from "@/utils/time";
import { MemberPicker } from "./MemberPicker";

type Props = { visible: boolean; shift: LeadShift | null; timeZone: string; onClose: () => void };

export function ShiftEditor({ visible, shift, timeZone, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const members = useLeadMembers();
  const upsert = useUpsertShift();
  const remove = useDeleteShift();
  const today = isoDateInZone(new Date(), timeZone);
  const dateChips = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysIso(today, i)), [today]);

  const { control, handleSubmit, formState, reset } = useForm<ShiftForm>({
    resolver: zodResolver(shiftFormSchema),
    values: shift
      ? {
          deskLabel: shift.desk_label,
          date: isoDateInZone(new Date(shift.start_time), timeZone),
          start: hhmmInZone(new Date(shift.start_time), timeZone),
          end: hhmmInZone(new Date(shift.end_time), timeZone),
          assignedMemberId: shift.assigned_member_id,
          backupMemberId: shift.backup_member_id,
        }
      : {
          deskLabel: "Front Desk",
          date: today,
          start: "08:00",
          end: "12:00",
          assignedMemberId: null,
          backupMemberId: null,
        },
  });

  const close = () => {
    upsert.reset();
    remove.reset();
    reset();
    onClose();
  };

  const onSave = handleSubmit((v) =>
    upsert.mutate(
      {
        shiftId: shift?.id ?? null,
        deskLabel: v.deskLabel,
        date: v.date,
        start: v.start,
        end: v.end,
        assignedMemberId: v.assignedMemberId,
        backupMemberId: v.backupMemberId,
      },
      {
        onSuccess: (r) => {
          haptics.success();
          if (r.warnings.includes("ambiguous_start_time")) {
            Alert.alert(
              "Daylight saving notice",
              "That start time occurs twice on this date. nxtshift used the first occurrence.",
            );
          }
          close();
        },
        onError: () => haptics.error(),
      },
    ),
  );

  const onDelete = () =>
    shift &&
    Alert.alert("Delete shift?", "Pending requests for this shift are removed as well.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(shift.id, { onSuccess: close }) },
    ]);

  const primaryId = useWatch({ control, name: "assignedMemberId" });
  const mutationError = upsert.error ?? remove.error;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView className="flex-1 bg-bg-secondary" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerClassName="gap-5 px-5 pt-6"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text accessibilityRole="header" className="text-2xl font-extrabold text-text">
            {shift ? "Edit shift" : "New shift"}
          </Text>
          <Text className="-mt-3 text-sm text-muted">Times are in the workspace time zone ({timeZone}).</Text>

          <Controller
            control={control}
            name="deskLabel"
            render={({ field }) => (
              <TextField
                label="Desk"
                value={field.value}
                onChangeText={field.onChange}
                maxLength={40}
                error={formState.errors.deskLabel?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <View className="gap-1.5">
                <Text className="text-xs font-bold tracking-[1.5px] text-muted">DATE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                  {dateChips.map((d) => (
                    <Chip
                      key={d}
                      label={formatDay(`${d}T12:00:00Z`, "UTC")}
                      selected={field.value === d}
                      onPress={() => field.onChange(d)}
                    />
                  ))}
                </ScrollView>
                <TextField
                  label="Or enter date"
                  value={field.value}
                  onChangeText={field.onChange}
                  placeholder="YYYY-MM-DD"
                  maxLength={10}
                  error={formState.errors.date?.message}
                />
              </View>
            )}
          />

          <View className="flex-row gap-3">
            {(["start", "end"] as const).map((name) => (
              <View key={name} className="flex-1">
                <Controller
                  control={control}
                  name={name}
                  render={({ field }) => (
                    <TextField
                      label={name === "start" ? "Start" : "End"}
                      value={field.value}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      placeholder="HH:MM"
                      onChangeText={field.onChange}
                      onBlur={() => field.onChange(normalizeTime(field.value) ?? field.value)}
                      error={formState.errors[name]?.message}
                    />
                  )}
                />
              </View>
            ))}
          </View>
          <Text className="-mt-3 text-xs text-muted">
            An end time earlier than the start means the shift runs past midnight.
          </Text>

          <Controller
            control={control}
            name="assignedMemberId"
            render={({ field }) => (
              <MemberPicker
                label="Primary"
                members={members.data ?? []}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="backupMemberId"
            render={({ field }) => (
              <MemberPicker
                label="Backup"
                members={members.data ?? []}
                value={field.value}
                onChange={field.onChange}
                excludeId={primaryId}
                error={formState.errors.backupMemberId?.message}
              />
            )}
          />

          {mutationError ? (
            <Text
              accessibilityRole="alert"
              className="rounded-xl border border-critical/50 bg-critical/10 p-3 text-base text-text"
            >
              {userMessage(mutationError)}
            </Text>
          ) : null}

          <Button
            label={shift ? "SAVE CHANGES" : "CREATE SHIFT"}
            size="lg"
            loading={upsert.isPending}
            onPress={() => void onSave()}
          />
          {shift ? (
            <Button label="Delete shift" variant="secondary" loading={remove.isPending} onPress={onDelete} />
          ) : null}
          <Button label="Cancel" variant="ghost" onPress={close} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
