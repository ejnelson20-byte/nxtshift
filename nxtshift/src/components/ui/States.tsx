import { AlertTriangle, Inbox } from "lucide-react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { userMessage } from "@/lib/errors";
import { colors } from "@/theme/tokens";
import { Button } from "./Button";

export function EmptyState({ title, message, icon }: { title: string; message?: string; icon?: ReactNode }) {
  return (
    <View accessible className="items-center gap-2 rounded-card border border-dashed border-border px-6 py-8">
      {icon ?? <Inbox color={colors.muted} size={28} />}
      <Text className="text-center text-base font-semibold text-text">{title}</Text>
      {message ? <Text className="text-center text-sm text-muted">{message}</Text> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      className="items-center gap-3 rounded-card border border-critical/50 bg-card px-6 py-6"
    >
      <AlertTriangle color={colors.critical} size={26} />
      <Text className="text-center text-base text-text">{userMessage(error)}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}
