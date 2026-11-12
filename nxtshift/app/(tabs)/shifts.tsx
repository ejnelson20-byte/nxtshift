import { CalendarX2 } from "lucide-react-native";
import { Text, View } from "react-native";
import { ScreenTitle, SectionHeader } from "@/components/ui/Card";
import { Freshness } from "@/components/ui/Freshness";
import { Screen } from "@/components/ui/Screen";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { NextShiftHero, ShiftCard } from "@/components/shifts/ShiftCards";
import { useMyShifts } from "@/features/shifts/hooks";
import { useSessionStore } from "@/stores/session-store";
import { colors } from "@/theme/tokens";

export default function MyShiftsScreen() {
  const profile = useSessionStore((s) => s.profile);
  const shifts = useMyShifts();
  if (!profile) return null;
  const tz = profile.workspace.timezone;

  // Next = the earliest shift that hasn't ended (query already excludes ended).
  const [next, ...upcoming] = shifts.data ?? [];

  return (
    <Screen refreshing={shifts.isRefetching} onRefresh={() => void shifts.refetch()}>
      <ScreenTitle
        title="MY SHIFTS"
        subtitle="Your upcoming duty assignments"
        right={<Freshness updatedAt={shifts.dataUpdatedAt} isError={shifts.isError} isFetching={shifts.isFetching} />}
      />

      {shifts.isLoading ? (
        <>
          <CardSkeleton lines={4} />
          <CardSkeleton lines={2} />
        </>
      ) : shifts.error && !shifts.data ? (
        <ErrorState error={shifts.error} onRetry={() => void shifts.refetch()} />
      ) : !next ? (
        <EmptyState
          title="No upcoming shifts"
          message="When a lead assigns you as primary or backup, your shifts appear here."
          icon={<CalendarX2 color={colors.muted} size={28} />}
        />
      ) : (
        <>
          <NextShiftHero shift={next} memberId={profile.member_id} timeZone={tz} />
          {upcoming.length > 0 ? (
            <View className="gap-3">
              <SectionHeader title="UPCOMING" />
              {upcoming.map((s) => (
                <ShiftCard key={s.id} shift={s} memberId={profile.member_id} timeZone={tz} />
              ))}
            </View>
          ) : null}
          <Text className="text-center text-xs leading-5 text-muted">
            Reminders are scheduled 60, 30 and 15 minutes before shifts where you&apos;re primary. Local reminders
            follow your device&apos;s Focus / Do Not Disturb settings and may be delayed by the OS.
          </Text>
        </>
      )}
    </Screen>
  );
}
