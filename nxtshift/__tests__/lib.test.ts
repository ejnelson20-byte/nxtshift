import { validateEnv } from "@/lib/env";
import { ApiError, userMessage } from "@/lib/errors";
import { createChunkedSecureStorage, type KeyValueBackend } from "@/lib/secure-storage";
import { joinSchema, normalizeTime, shiftFormSchema } from "@/lib/validation";
import { canAssumeDuty } from "@/features/shifts/api";
import { toApiError } from "@/services/api";
import { formatCountdown, mondayOf, remainingValidity } from "@/utils/time";

function memoryBackend(): KeyValueBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItemAsync: async (k) => map.get(k) ?? null,
    setItemAsync: async (k, v) => void map.set(k, v),
    deleteItemAsync: async (k) => void map.delete(k),
  };
}

describe("chunked secure session storage", () => {
  it("round-trips values larger than a single SecureStore entry", async () => {
    const backend = memoryBackend();
    const storage = createChunkedSecureStorage(backend);
    const session = JSON.stringify({ access_token: "a".repeat(5000), refresh_token: "r".repeat(100) });
    await storage.setItem("sb-auth-token", session);
    expect([...backend.map.values()].every((v) => v.length <= 1800)).toBe(true);
    expect(await storage.getItem("sb-auth-token")).toBe(session);
  });

  it("session restoration returns null when nothing is stored, and removal clears every chunk", async () => {
    const backend = memoryBackend();
    const storage = createChunkedSecureStorage(backend);
    expect(await storage.getItem("missing")).toBeNull();
    await storage.setItem("k", "x".repeat(4000));
    await storage.removeItem("k");
    expect(backend.map.size).toBe(0);
  });

  it("treats a torn write (missing chunk) as no session", async () => {
    const backend = memoryBackend();
    const storage = createChunkedSecureStorage(backend);
    await storage.setItem("k", "y".repeat(4000));
    backend.map.delete("k.1");
    expect(await storage.getItem("k")).toBeNull();
  });

  it("shrinking a value removes stale chunks", async () => {
    const backend = memoryBackend();
    const storage = createChunkedSecureStorage(backend);
    await storage.setItem("k", "z".repeat(5000));
    await storage.setItem("k", "short");
    expect(await storage.getItem("k")).toBe("short");
    expect(backend.map.has("k.2")).toBe(false);
  });
});

describe("environment validation", () => {
  const base = { supabaseUrl: "https://abc.supabase.co", easProjectId: "00000000-0000-4000-8000-000000000000" };

  it("accepts a publishable key", () => {
    expect(validateEnv({ ...base, supabaseKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz" }).ok).toBe(true);
  });

  it("rejects secret and service-role keys in the client", () => {
    expect(validateEnv({ ...base, supabaseKey: "sb_secret_abcdefghijklmnopqrstuvwxyz" }).ok).toBe(false);
    const payload = btoa(JSON.stringify({ role: "service_role" })).replace(/=+$/, "");
    expect(validateEnv({ ...base, supabaseKey: `eyJhbGciOiJIUzI1NiJ9.${payload}.signature` }).ok).toBe(false);
  });

  it("reports missing configuration", () => {
    const r = validateEnv({});
    expect(r.ok).toBe(false);
  });
});

describe("validation", () => {
  it("normalizes and validates invite codes", () => {
    expect(joinSchema.parse({ inviteCode: " r7k2q9 ", callsign: "Runner_Alpha" }).inviteCode).toBe("R7K2Q9");
    expect(joinSchema.safeParse({ inviteCode: "R7K2Q0", callsign: "Runner_Alpha" }).success).toBe(false); // 0 not in alphabet
    expect(joinSchema.safeParse({ inviteCode: "R7K2Q9", callsign: "ab" }).success).toBe(false);
  });

  it("normalizes times", () => {
    expect(normalizeTime("0800")).toBe("08:00");
    expect(normalizeTime("8:00")).toBe("08:00");
    expect(normalizeTime("2400")).toBeNull();
    expect(normalizeTime("8am")).toBeNull();
  });

  it("requires distinct primary and backup", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const r = shiftFormSchema.safeParse({
      deskLabel: "Front",
      date: "2030-01-01",
      start: "08:00",
      end: "12:00",
      assignedMemberId: id,
      backupMemberId: id,
    });
    expect(r.success).toBe(false);
  });
});

describe("assume-duty window (UI gating; server enforces)", () => {
  const shift = (startOffsetMin: number, checkedIn = false) => ({
    id: "s",
    desk_label: "Front",
    assigned_member_id: "me",
    backup_member_id: "b",
    start_time: new Date(Date.UTC(2030, 0, 1, 12, startOffsetMin)).toISOString(),
    end_time: new Date(Date.UTC(2030, 0, 1, 16)).toISOString(),
    is_checked_in: checkedIn,
  });
  const noon = Date.UTC(2030, 0, 1, 12);

  it("enables 15 minutes before start for the primary only", () => {
    expect(canAssumeDuty(shift(15), "me", noon)).toBe(true);
    expect(canAssumeDuty(shift(16), "me", noon)).toBe(false);
    expect(canAssumeDuty(shift(0), "b", noon)).toBe(false);
    expect(canAssumeDuty(shift(0, true), "me", noon)).toBe(false);
  });
});

describe("time formatting", () => {
  it("formats countdowns", () => {
    expect(formatCountdown(((2 * 60 + 34) * 60 + 18) * 1000)).toBe("02h 34m 18s");
    expect(formatCountdown(-5)).toBe("00h 00m 00s");
    expect(formatCountdown(26 * 3600_000)).toBe("1d 02h 00m 00s");
  });

  it("reports remaining validity of 24h items", () => {
    const created = new Date(Date.UTC(2030, 0, 1, 0)).toISOString();
    expect(remainingValidity(created, Date.UTC(2030, 0, 1, 19))).toBe("expires in 5h");
    expect(remainingValidity(created, Date.UTC(2030, 0, 2, 1))).toBe("expired");
  });

  it("finds the Monday of a week in the workspace zone", () => {
    // Sunday 2030-11-17 23:30 in New York is Monday 04:30 UTC.
    expect(mondayOf(new Date("2030-11-18T04:30:00Z"), "America/New_York")).toBe("2030-11-11");
    expect(mondayOf(new Date("2030-11-18T04:30:00Z"), "UTC")).toBe("2030-11-18");
  });
});

describe("API error mapping", () => {
  it("maps RPC business errors to stable codes and hides unknown errors", () => {
    expect(toApiError({ message: "no_active_shift", code: "P0001" }).code).toBe("no_active_shift");
    expect(toApiError({ message: "permission denied for table members", code: "42501" }).code).toBe("not_authorized");
    expect(toApiError({ message: "TypeError: Network request failed" }).code).toBe("network_error");
    const unknown = toApiError({ message: 'relation "x" does not exist', code: "42P01" });
    expect(userMessage(unknown)).toBe("Something went wrong. Please try again.");
  });

  it("produces user copy for known codes", () => {
    expect(userMessage(new ApiError("callsign_taken"))).toMatch(/already in use/);
  });
});
