// Deterministic mocks for native modules used by the app.

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.mock("expo-crypto", () => {
  let n = 0;
  return { randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`) };
});

jest.mock("expo-notifications", () => {
  const scheduled = new Map<string, unknown>();
  return {
    SchedulableTriggerInputTypes: { DATE: "date" },
    AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
    AndroidNotificationVisibility: { PRIVATE: 0 },
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
    getAllScheduledNotificationsAsync: jest.fn(async () =>
      [...scheduled.entries()].map(([identifier, request]) => ({ identifier, ...(request as object) })),
    ),
    scheduleNotificationAsync: jest.fn(async (req: { identifier: string }) => {
      scheduled.set(req.identifier, req);
      return req.identifier;
    }),
    cancelScheduledNotificationAsync: jest.fn(async (id: string) => void scheduled.delete(id)),
    __scheduled: scheduled,
  };
});

// Icons are decorative; render a plain View in tests (lucide ships ESM-only).
jest.mock("lucide-react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return new Proxy({}, { get: () => View });
});

// Minimal Reanimated mock covering the APIs nxtshift uses (no worklet
// runtime in Jest). Animations resolve to their final values.
jest.mock("react-native-reanimated", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const layoutAnimation = () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["delay", "duration", "springify", "easing"]) chain[k] = () => chain;
    return chain;
  };
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (fn: () => object) => fn(),
    useReducedMotion: () => false,
    withTiming: (v: unknown) => v,
    withRepeat: (v: unknown) => v,
    cancelAnimation: () => undefined,
    Easing: { out: () => () => 0, quad: () => 0 },
    FadeInDown: layoutAnimation(),
    FadeInUp: layoutAnimation(),
    FadeOutUp: layoutAnimation(),
  };
});
