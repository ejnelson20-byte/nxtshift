import { useState } from "react";
import { AccountSheet } from "@/components/desk/AccountSheet";
import { ActiveDeskCard } from "@/components/desk/ActiveDeskCard";
import { DeskHeader } from "@/components/desk/DeskHeader";
import { IncomingPings } from "@/components/desk/IncomingPings";
import { MyRequests } from "@/components/desk/MyRequests";
import { PingComposer } from "@/components/desk/PingComposer";
import { TopAlerts } from "@/components/desk/TopAlerts";
import { Screen } from "@/components/ui/Screen";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { useDeskStatus, useIncomingPings, useMySentPings, useTopAlerts } from "@/features/desk/hooks";
import { useSessionStore } from "@/stores/session-store";

export default function DeskScreen() {
  const profile = useSessionStore((s) => s.profile);
  const desk = useDeskStatus();
  const alerts = useTopAlerts();
  const incoming = useIncomingPings();
  const mine = useMySentPings();
  const [selectedDesk, setSelectedDesk] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const desks = desk.data ?? [];
  // A selection is ignored once that desk is no longer active.
  const activeSelection = desks.some((d) => d.desk_label === selectedDesk) ? selectedDesk : null;

  if (!profile) return null;
  const tz = profile.workspace.timezone;
  const deskLabel = desks.length === 1 ? desks[0]!.desk_label : activeSelection;

  return (
    <Screen
      refreshing={desk.isRefetching}
      onRefresh={() => {
        void desk.refetch();
        void alerts.refetch();
        void incoming.refetch();
      }}
    >
      <DeskHeader
        workspaceName={profile.workspace.name}
        timeZone={tz}
        callsign={profile.callsign}
        updatedAt={desk.dataUpdatedAt}
        isError={desk.isError}
        isFetching={desk.isFetching}
        onAccountPress={() => setAccountOpen(true)}
      />

      <IncomingPings pings={incoming.data} />

      {desk.isLoading ? (
        <CardSkeleton lines={2} />
      ) : desk.error && !desk.data ? (
        <ErrorState error={desk.error} onRetry={() => void desk.refetch()} />
      ) : (
        <ActiveDeskCard desks={desks} selected={activeSelection} onSelect={setSelectedDesk} timeZone={tz} />
      )}

      <PingComposer activeDeskCount={desk.data ? desks.length : 0} deskLabel={deskLabel} />

      <MyRequests pings={mine.data} />

      <TopAlerts
        alerts={alerts.data}
        isLoading={alerts.isLoading}
        error={alerts.error}
        onRetry={() => void alerts.refetch()}
      />

      <AccountSheet visible={accountOpen} onClose={() => setAccountOpen(false)} />
    </Screen>
  );
}
