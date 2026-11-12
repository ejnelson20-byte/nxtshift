import { useMutation } from "@tanstack/react-query";
import { Sparkles, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/TextField";
import {
  importShifts,
  parseSchedule,
  rowIsComplete,
  type ImportRow,
  type ParsedRow,
} from "@/features/schedule-import/api";
import { queryClient } from "@/lib/query-client";
import { describeCode, userMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { colors } from "@/theme/tokens";
import { addDaysIso, formatDay, mondayOf } from "@/utils/time";

const COLUMNS: { key: keyof ImportRow; label: string; width: string; placeholder: string }[] = [
  { key: "date", label: "Date", width: "w-28", placeholder: "YYYY-MM-DD" },
  { key: "start_time", label: "Start", width: "w-16", placeholder: "HH:MM" },
  { key: "end_time", label: "End", width: "w-16", placeholder: "HH:MM" },
  { key: "primary_callsign", label: "Primary", width: "w-32", placeholder: "Callsign" },
  { key: "backup_callsign", label: "Backup", width: "w-32", placeholder: "(none)" },
  { key: "desk_label", label: "Desk", width: "w-32", placeholder: "Desk" },
];

/** Editable review table. Edited rows lose stale issues until revalidated server-side. */
function PreviewTable({
  rows,
  onChange,
  onRemove,
}: {
  rows: ParsedRow[];
  onChange: (i: number, key: keyof ImportRow, v: string) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <View className="gap-2">
      {rows.map((row, i) => (
        <Card key={i} tone={row.issues.length ? "warning" : "default"} className="gap-2 p-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-bold tracking-[1.5px] text-muted">ROW {i + 1}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove row ${i + 1}`}
              hitSlop={10}
              onPress={() => onRemove(i)}
              className="h-9 w-9 items-center justify-center"
            >
              <Trash2 color={colors.muted} size={18} />
            </Pressable>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {COLUMNS.map((c) => (
              <View key={c.key} className={`${c.width} grow gap-1`}>
                <Text className="text-[10px] font-bold tracking-[1px] text-muted">{c.label.toUpperCase()}</Text>
                <TextInput
                  accessibilityLabel={`Row ${i + 1} ${c.label}`}
                  value={row[c.key] ?? ""}
                  placeholder={c.placeholder}
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(v) => onChange(i, c.key, v)}
                  className="min-h-11 rounded-lg border border-border bg-bg-secondary px-2 text-sm text-text"
                />
              </View>
            ))}
          </View>
          {row.issues.map((issue) => (
            <Text key={issue} className="text-sm text-warning">
              • {describeCode(issue)}
            </Text>
          ))}
        </Card>
      ))}
    </View>
  );
}

export function SmartImport({ timeZone }: { timeZone: string }) {
  const [text, setText] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [defaultDesk, setDefaultDesk] = useState("Front Desk");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);

  const weekStart = addDaysIso(mondayOf(new Date(), timeZone), weekOffset * 7);

  const parse = useMutation({
    mutationFn: () => parseSchedule({ text, weekStart, defaultDesk: defaultDesk.trim() || undefined }),
    onSuccess: (r) => {
      haptics.success();
      setRows(r.shifts);
      setWarnings(r.warnings);
      setResult(null);
    },
    onError: () => haptics.error(),
  });

  const commit = useMutation({
    mutationFn: (payload: ImportRow[]) => importShifts(payload, true),
    onSuccess: (r) => {
      if (r.status === "imported") {
        haptics.success();
        setResult(`Imported ${r.imported_count} shift${r.imported_count === 1 ? "" : "s"}.`);
        setRows(null);
        setText("");
        void queryClient.invalidateQueries({ queryKey: ["lead"] });
      } else {
        haptics.error();
        // Nothing was inserted; surface per-row errors for correction.
        setRows(
          (prev) =>
            prev?.map((row, i) => {
              const err = r.rows.find((x) => x.index === i && !x.ok)?.error;
              return err ? { ...row, issues: [err] } : { ...row, issues: [] };
            }) ?? null,
        );
      }
    },
  });

  const editRow = (i: number, key: keyof ImportRow, value: string) =>
    setRows(
      (prev) =>
        prev?.map((r, idx) => (idx === i ? { ...r, [key]: value.trim() === "" ? null : value, issues: [] } : r)) ??
        null,
    );

  const ready = rows !== null && rows.length > 0 && rows.every((r) => r.issues.length === 0 && rowIsComplete(r));

  return (
    <View className="gap-3">
      <SectionHeader title="SMART IMPORT" subtitle="Paste a schedule and nxtshift will organize it." />
      <Card className="gap-4">
        <TextField
          label="Schedule text"
          multiline
          textAlignVertical="top"
          className="min-h-40 font-mono text-sm"
          placeholder={"Monday\n0800-1200 Primary: Runner_02, Backup: Runner_05"}
          value={text}
          onChangeText={setText}
          maxLength={8000}
          hint={`${text.length}/8000 · Parsed text is sent to the configured AI provider. Don't paste personal information.`}
        />
        <View className="gap-1.5">
          <Text className="text-xs font-bold tracking-[1.5px] text-muted">WEEK STARTING</Text>
          <View className="flex-row flex-wrap gap-2">
            {[0, 1, 2].map((o) => (
              <Chip
                key={o}
                label={formatDay(`${addDaysIso(mondayOf(new Date(), timeZone), o * 7)}T12:00:00Z`, "UTC")}
                selected={weekOffset === o}
                onPress={() => setWeekOffset(o)}
              />
            ))}
          </View>
          <Text className="text-xs text-muted">
            Weekday names (e.g. “Monday”) resolve to this week. Lines without a day are flagged, never guessed.
          </Text>
        </View>
        <TextField
          label="Default desk"
          value={defaultDesk}
          onChangeText={setDefaultDesk}
          maxLength={40}
          hint="Used when a line doesn't name a desk."
        />
        {parse.error ? <Text className="text-sm text-critical">{userMessage(parse.error)}</Text> : null}
        <Button
          label="PARSE SCHEDULE"
          icon={<Sparkles color={colors.bg} size={18} />}
          loading={parse.isPending}
          disabled={text.trim().length < 10}
          onPress={() => parse.mutate()}
        />
      </Card>

      {rows ? (
        <View className="gap-3">
          <SectionHeader
            title="REVIEW BEFORE IMPORT"
            subtitle="Nothing is saved until you confirm. Edit any row to fix issues."
          />
          {warnings.map((w) => (
            <Text key={w} className="text-sm text-warning">
              ⚠ {w}
            </Text>
          ))}
          {rows.length === 0 ? <Text className="text-sm text-muted">No shifts found.</Text> : null}
          <PreviewTable
            rows={rows}
            onChange={editRow}
            onRemove={(i) => setRows((prev) => prev?.filter((_, idx) => idx !== i) ?? null)}
          />
          {commit.error ? <Text className="text-sm text-critical">{userMessage(commit.error)}</Text> : null}
          <Button
            label="CONFIRM & IMPORT"
            size="lg"
            haptic="press"
            disabled={!ready}
            loading={commit.isPending}
            accessibilityHint={
              ready ? "Imports all rows in one transaction" : "Resolve every issue and fill all fields first"
            }
            onPress={() =>
              rows &&
              commit.mutate(
                rows.map(({ issues: _issues, ...r }) => ({ ...r, backup_callsign: r.backup_callsign || null })),
              )
            }
          />
          <Button label="Discard" variant="ghost" onPress={() => setRows(null)} />
        </View>
      ) : null}
      {result ? (
        <Card tone="success">
          <Text className="text-base font-semibold text-text">{result}</Text>
        </Card>
      ) : null}
    </View>
  );
}
