import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { JoinForm } from "@/features/auth/JoinForm";
import { colors } from "@/theme/tokens";

export default function Join() {
  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(auth)/welcome"))}
        hitSlop={12}
        className="-ml-2 h-11 w-11 items-center justify-center"
      >
        <ChevronLeft color={colors.text} size={26} />
      </Pressable>
      <View className="gap-2">
        <Text accessibilityRole="header" className="text-3xl font-extrabold text-text">
          Join workspace
        </Text>
        <Text className="text-base text-muted">Enter the invite code from your lead and pick a callsign.</Text>
      </View>
      <JoinForm onJoined={() => router.replace("/(tabs)")} />
    </Screen>
  );
}
