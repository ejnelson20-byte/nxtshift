import { UserRound } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { Freshness } from "@/components/ui/Freshness";
import { useNow } from "@/hooks/use-now";
import { colors } from "@/theme/tokens";
import { formatDateTimeHeader } from "@/utils/time";

function Clock({ timeZone }: { timeZone: string }) {
  // Isolated so only this text re-renders each minute.
  const now = useNow(60_000);
  return <Text className="text-sm text-muted">{formatDateTimeHeader(new Date(now), timeZone)}</Text>;
}

type Props = {
  workspaceName: string;
  timeZone: string;
  callsign: string;
  updatedAt: number;
  isError: boolean;
  isFetching: boolean;
  onAccountPress: () => void;
};

export function DeskHeader({
  workspaceName,
  timeZone,
  callsign,
  updatedAt,
  isError,
  isFetching,
  onAccountPress,
}: Props) {
  return (
    <View className="flex-row items-start justify-between pt-2">
      <View className="flex-1 gap-1">
        <Text accessibilityRole="header" className="text-[28px] font-extrabold tracking-tight text-text">
          nxtshift
        </Text>
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <Text className="text-sm font-semibold text-text">{workspaceName}</Text>
          <Freshness updatedAt={updatedAt} isError={isError} isFetching={isFetching} />
        </View>
        <Clock timeZone={timeZone} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Account: ${callsign}`}
        onPress={onAccountPress}
        hitSlop={8}
        className="min-h-11 flex-row items-center gap-2 rounded-full border border-border bg-card px-3"
      >
        <UserRound color={colors.accent} size={16} />
        <Text className="max-w-28 text-sm font-semibold text-text" numberOfLines={1}>
          {callsign}
        </Text>
      </Pressable>
    </View>
  );
}
