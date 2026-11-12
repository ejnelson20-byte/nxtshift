import { Redirect, Tabs } from "expo-router";
import { CalendarClock, Radio, ShieldHalf } from "lucide-react-native";
import { useSignedInEffects } from "@/features/auth/use-signed-in-effects";
import { isLeadRole, useSessionStore } from "@/stores/session-store";
import { colors } from "@/theme/tokens";

function SignedInTabs() {
  useSignedInEffects();
  const isLead = useSessionStore((s) => isLeadRole(s.profile));

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors["bg-secondary"], borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Desk",
          tabBarAccessibilityLabel: "Desk",
          tabBarIcon: ({ color, size }) => <Radio color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="shifts"
        options={{
          title: "My Shifts",
          tabBarAccessibilityLabel: "My Shifts",
          tabBarIcon: ({ color, size }) => <CalendarClock color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="lead"
        options={{
          title: "Lead Console",
          tabBarAccessibilityLabel: "Lead Console",
          // Hidden for members. This is UX only — every lead action is
          // authorized server-side.
          href: isLead ? undefined : null,
          tabBarIcon: ({ color, size }) => <ShieldHalf color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

export default function TabsLayout() {
  const status = useSessionStore((s) => s.status);
  if (status === "booting") return null;
  if (status !== "ready") return <Redirect href="/(auth)/welcome" />;
  return <SignedInTabs />;
}
