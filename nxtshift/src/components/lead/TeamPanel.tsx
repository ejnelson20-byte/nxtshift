import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { useInvite, useLeadMembers, useRotateInvite, useSetMemberRole } from "@/features/lead/hooks";
import { userMessage } from "@/lib/errors";
import { useSessionStore } from "@/stores/session-store";
import type { LeadMember, MemberRole } from "@/types/domain";

function InviteCard({ isAdmin }: { isAdmin: boolean }) {
  const invite = useInvite();
  const rotate = useRotateInvite();
  const [revealed, setRevealed] = useState(false);
  return (
    <Card className="gap-3">
      <Text className="text-xs font-bold tracking-[1.5px] text-muted">INVITE CODE</Text>
      <Text
        accessibilityLabel={
          revealed ? `Invite code ${invite.data?.invite_code.split("").join(" ")}` : "Invite code hidden"
        }
        className="font-mono text-3xl font-extrabold tracking-[8px] text-text"
      >
        {revealed ? (invite.data?.invite_code ?? "······") : "••••••"}
      </Text>
      {invite.data && !invite.data.active ? <Badge label="INACTIVE" tone="warning" /> : null}
      <Text className="text-xs text-muted">
        Share only in person or through a trusted channel. Anyone with this code can join as a member.
      </Text>
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button label={revealed ? "Hide" : "Reveal"} variant="secondary" onPress={() => setRevealed((v) => !v)} />
        </View>
        {isAdmin ? (
          <View className="flex-1">
            <Button
              label="Rotate"
              variant="secondary"
              loading={rotate.isPending}
              onPress={() =>
                Alert.alert("Rotate invite code?", "The current code stops working immediately.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Rotate", style: "destructive", onPress: () => rotate.mutate() },
                ])
              }
            />
          </View>
        ) : null}
      </View>
      {rotate.error ? <Text className="text-sm text-critical">{userMessage(rotate.error)}</Text> : null}
    </Card>
  );
}

function MemberRow({ member, isAdmin, isSelf }: { member: LeadMember; isAdmin: boolean; isSelf: boolean }) {
  const setRole = useSetMemberRole();
  const next: MemberRole = member.role === "member" ? "lead" : "member";
  return (
    <View className="min-h-14 flex-row items-center justify-between gap-3 border-b border-border py-2">
      <View className="flex-1">
        <Text className="text-base font-semibold text-text">
          {member.callsign}
          {isSelf ? " (you)" : ""}
        </Text>
        <Text className="text-xs text-muted">
          {member.has_device ? "Device registered" : "No device — won't receive pushes"}
        </Text>
      </View>
      <Badge label={member.role.toUpperCase()} tone={member.role === "member" ? "muted" : "accent"} />
      {isAdmin && !isSelf && member.role !== "admin" ? (
        <Button
          label={next === "lead" ? "Make lead" : "Demote"}
          variant="ghost"
          loading={setRole.isPending}
          onPress={() => setRole.mutate({ memberId: member.id, role: next })}
        />
      ) : null}
    </View>
  );
}

export function TeamPanel() {
  const profile = useSessionStore((s) => s.profile);
  const members = useLeadMembers();
  const isAdmin = profile?.role === "admin";
  return (
    <View className="gap-3">
      <SectionHeader title="TEAM" subtitle="Callsigns only. Push tokens are never exposed." />
      <InviteCard isAdmin={isAdmin} />
      <Card>
        {(members.data ?? []).map((m) => (
          <MemberRow key={m.id} member={m} isAdmin={isAdmin} isSelf={m.id === profile?.member_id} />
        ))}
        {members.isLoading ? <Text className="text-sm text-muted">Loading…</Text> : null}
      </Card>
    </View>
  );
}
