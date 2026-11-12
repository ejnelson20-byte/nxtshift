import { invokeFunction, rpc } from "@/services/api";

export type ImportRow = {
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  primary_callsign: string | null;
  backup_callsign: string | null;
  desk_label: string | null;
};

export type ParsedRow = ImportRow & { issues: string[] };

export type ParseResponse = { shifts: ParsedRow[]; warnings: string[]; timezone: string };

export type ImportResponse = {
  status: "valid" | "invalid" | "imported";
  imported_count: number;
  rows: { index: number; ok: boolean; error?: string; warnings?: string[] }[];
};

export function parseSchedule(input: {
  text: string;
  weekStart: string;
  defaultDesk?: string;
}): Promise<ParseResponse> {
  return invokeFunction<ParseResponse>("parse-shift-schedule", {
    text: input.text,
    week_start: input.weekStart,
    ...(input.defaultDesk ? { default_desk_label: input.defaultDesk } : {}),
  });
}

/** All-or-nothing server-validated import. Only called after explicit confirmation. */
export function importShifts(rows: ImportRow[], commit: boolean): Promise<ImportResponse> {
  return rpc<ImportResponse>("lead_import_shifts", { p_rows: rows, p_commit: commit });
}

/** Client-side completeness check before enabling CONFIRM & IMPORT. */
export function rowIsComplete(row: ImportRow): boolean {
  return Boolean(
    row.date &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
    row.start_time &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(row.start_time) &&
    row.end_time &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(row.end_time) &&
    row.primary_callsign &&
    row.desk_label,
  );
}
