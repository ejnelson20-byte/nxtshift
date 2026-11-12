// Time formatting. Shift times are shown in the workspace time zone so every
// member sees the same wall-clock schedule regardless of device settings.

export function formatTime(iso: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(iso),
  );
}

export function formatDay(iso: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(
    new Date(iso),
  );
}

export function formatDateTimeHeader(now: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(now);
}

/** "YYYY-MM-DD" for a date as seen in the given time zone. */
export function isoDateInZone(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "HH:MM" wall-clock time in the given zone. */
export function hhmmInZone(date: Date, timeZone?: string): string {
  return formatTime(date, timeZone);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Countdown like "02h 34m 18s" (days prefix when ≥ 24h). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const clock = `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

/** Remaining validity of a 24h item, e.g. "expires in 5h". */
export function remainingValidity(createdIso: string, now: number = Date.now(), ttlMs = 24 * 3600_000): string {
  const left = new Date(createdIso).getTime() + ttlMs - now;
  if (left <= 0) return "expired";
  if (left < 3600_000) return `expires in ${Math.max(1, Math.round(left / 60_000))}m`;
  return `expires in ${Math.round(left / 3600_000)}h`;
}

/** Monday of the week containing `date` (in zone), as YYYY-MM-DD. */
export function mondayOf(date: Date, timeZone?: string): string {
  const iso = isoDateInZone(date, timeZone);
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
