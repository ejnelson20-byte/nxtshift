import { Text } from "react-native";
import { useNow } from "@/hooks/use-now";
import { formatCountdown } from "@/utils/time";

/** Self-contained 1 Hz ticker so parent cards don't re-render every second. */
export function Countdown({ target, label }: { target: string; label: string }) {
  const now = useNow(1000);
  const ms = new Date(target).getTime() - now;
  const text = formatCountdown(ms);
  return (
    <Text
      accessibilityLabel={`${label} ${text.replace(/h/, " hours").replace(/m/, " minutes").replace(/s$/, " seconds")}`}
      className="font-mono text-4xl font-extrabold tracking-tight text-text"
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {text}
    </Text>
  );
}
