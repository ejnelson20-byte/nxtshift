import { Text, View } from "react-native";
import { useNow } from "@/hooks/use-now";
import { relativeTime } from "@/utils/time";

/**
 * Distinguishes live operational data from cached data. "LIVE" only when the
 * last successful fetch is recent and the latest attempt didn't fail.
 */
export function Freshness({
  updatedAt,
  isError,
  isFetching,
}: {
  updatedAt: number;
  isError: boolean;
  isFetching?: boolean;
}) {
  const now = useNow(15_000);
  if (!updatedAt) return null;
  const ageMs = now - updatedAt;
  const live = !isError && ageMs < 90_000;
  const label = live
    ? isFetching
      ? "SYNCING"
      : "LIVE"
    : `CACHED · ${relativeTime(new Date(updatedAt).toISOString(), now)}`;
  return (
    <View
      accessible
      accessibilityLabel={
        live ? "Live data" : `Showing cached data from ${relativeTime(new Date(updatedAt).toISOString(), now)}`
      }
      className="flex-row items-center gap-1.5"
    >
      <View className={`h-2 w-2 rounded-full ${live ? "bg-success" : "bg-warning"}`} />
      <Text className={`text-[11px] font-bold tracking-[1px] ${live ? "text-success" : "text-warning"}`}>{label}</Text>
    </View>
  );
}
