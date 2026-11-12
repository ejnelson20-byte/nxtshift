import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/theme/tokens";

type Props = {
  children: ReactNode;
  /** Pull-to-refresh handler. */
  onRefresh?: () => void;
  refreshing?: boolean;
  scroll?: boolean;
  edges?: ("top" | "bottom")[];
};

export function Screen({ children, onRefresh, refreshing = false, scroll = true, edges = ["top"] }: Props) {
  return (
    <SafeAreaView edges={edges} className="flex-1 bg-bg">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {scroll ? (
          <ScrollView
            className="flex-1"
            contentContainerClassName="px-5 pb-10 pt-2 gap-5"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
              ) : undefined
            }
          >
            {children}
          </ScrollView>
        ) : (
          <View className="flex-1 px-5 pt-2">{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
