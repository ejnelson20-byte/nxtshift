import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { OpenPings } from "@/components/lead/OpenPings";
import { PostTopAlert } from "@/components/lead/PostTopAlert";
import { ScheduleManager } from "@/components/lead/ScheduleManager";
import { SmartImport } from "@/components/lead/SmartImport";
import { SummaryGrid } from "@/components/lead/SummaryGrid";
import { TeamPanel } from "@/components/lead/TeamPanel";
import { ScreenTitle } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Screen } from "@/components/ui/Screen";
import { useLeadSummary } from "@/features/lead/hooks";
import { isLeadRole, useSessionStore } from "@/stores/session-store";

const SECTIONS = ["Overview", "Schedule", "Import", "Alerts", "Team"] as const;
type Section = (typeof SECTIONS)[number];

export default function LeadConsoleScreen() {
  const profile = useSessionStore((s) => s.profile);
  const [section, setSection] = useState<Section>("Overview");
  const summary = useLeadSummary();

  // Defense in depth for deep links; the server rejects non-lead calls anyway.
  if (!isLeadRole(profile) || !profile) return <Redirect href="/" />;
  const tz = profile.workspace.timezone;

  return (
    <Screen refreshing={summary.isRefetching} onRefresh={() => void summary.refetch()}>
      <ScreenTitle title="LEAD CONSOLE" subtitle="Manage shifts and critical announcements" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
        accessibilityRole="tablist"
      >
        {SECTIONS.map((s) => (
          <Chip key={s} label={s} selected={section === s} onPress={() => setSection(s)} />
        ))}
      </ScrollView>

      {section === "Overview" ? (
        <View className="gap-5">
          <SummaryGrid
            data={summary.data}
            isLoading={summary.isLoading}
            error={summary.error}
            onRetry={() => void summary.refetch()}
          />
          <OpenPings />
        </View>
      ) : null}
      {section === "Schedule" ? <ScheduleManager timeZone={tz} /> : null}
      {section === "Import" ? <SmartImport timeZone={tz} /> : null}
      {section === "Alerts" ? <PostTopAlert /> : null}
      {section === "Team" ? <TeamPanel /> : null}
    </Screen>
  );
}
