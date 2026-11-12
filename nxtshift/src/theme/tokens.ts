import palette from "./colors.json";

export const colors = palette.colors;

export type ColorName = keyof typeof colors;

export const priorityColor: Record<"normal" | "high" | "critical", string> = {
  normal: colors.accent,
  high: colors.warning,
  critical: colors.critical,
};
