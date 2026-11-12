import { Text, View } from "react-native";

type Tone = "accent" | "success" | "warning" | "critical" | "muted";

const toneClass: Record<Tone, { box: string; text: string; dot: string }> = {
  accent: { box: "bg-accent/15 border-accent/40", text: "text-accent", dot: "bg-accent" },
  success: { box: "bg-success/15 border-success/40", text: "text-success", dot: "bg-success" },
  warning: { box: "bg-warning/15 border-warning/40", text: "text-warning", dot: "bg-warning" },
  critical: { box: "bg-critical/15 border-critical/40", text: "text-critical", dot: "bg-critical" },
  muted: { box: "bg-elevated border-border", text: "text-muted", dot: "bg-muted" },
};

export function Badge({ label, tone = "muted", dot = false }: { label: string; tone?: Tone; dot?: boolean }) {
  const t = toneClass[tone];
  return (
    <View className={`flex-row items-center gap-1.5 self-start rounded-full border px-2.5 py-1 ${t.box}`}>
      {dot ? <View className={`h-2 w-2 rounded-full ${t.dot}`} /> : null}
      <Text className={`text-[11px] font-bold tracking-[1px] ${t.text}`}>{label}</Text>
    </View>
  );
}
