import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb, rejectsWith, type TestDb } from "./harness.ts";

type Ws = { id: string; invite: string };
type M = { uid: string; id: string };

describe("shift check-in (Assume Duty) and handoff", () => {
  let db: TestDb;
  let ws: Ws;
  let outgoing: M;
  let incoming: M;
  let stranger: M;

  before(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
    outgoing = await db.member(ws, "Runner_01");
    incoming = await db.member(ws, "Runner_02");
    stranger = await db.member(ws, "Runner_03");
  });
  after(async () => db.close());

  test("valid check-in within 15 minutes of start records a handoff and notifies the outgoing member", async () => {
    const prev = await db.shift(ws.id, { startMin: -230, endMin: 10, assigned: outgoing.id, checkedIn: true });
    const next = await db.shift(ws.id, { startMin: 10, endMin: 250, assigned: incoming.id });

    const r = await db.rpc<{ status: string; relieved_previous_shift: boolean }>(incoming.uid, "assume_duty", [next]);
    assert.equal(r.status, "checked_in");
    assert.equal(r.relieved_previous_shift, true);

    const rows = await db.admin<{ id: string; is_checked_in: boolean }>(
      "select id, is_checked_in from public.shifts where id in ($1, $2)",
      [prev, next],
    );
    assert.equal(rows.find((s) => s.id === prev)?.is_checked_in, false);
    assert.equal(rows.find((s) => s.id === next)?.is_checked_in, true);

    const [handoff] = await db.admin("select * from private.shift_handoffs where shift_id = $1", [next]);
    assert.equal(handoff.outgoing_member_id, outgoing.id);
    assert.equal(handoff.incoming_member_id, incoming.id);

    const [push] = await db.admin("select * from private.push_outbox where kind = 'shift_handoff'");
    assert.equal(push.recipient_member_id, outgoing.id);
    assert.equal(push.status, "pending");

    // Active desk now routes to the incoming (checked-in) shift.
    const [active] = await db.admin<{ id: string }>("select (private.active_shift_for_desk($1, null)).id", [ws.id]);
    assert.equal(active.id, next);
  });

  test("duplicate check-in is handled idempotently", async () => {
    const s = await db.shift(ws.id, { desk: "North Desk", startMin: -5, endMin: 120, assigned: incoming.id });
    await db.rpc(incoming.uid, "assume_duty", [s]);
    const again = await db.rpc<{ status: string }>(incoming.uid, "assume_duty", [s]);
    assert.equal(again.status, "already_checked_in");
    const handoffs = await db.admin("select * from private.shift_handoffs where shift_id = $1", [s]);
    assert.equal(handoffs.length, 1);
  });

  test("early check-in is rejected", async () => {
    const s = await db.shift(ws.id, { desk: "East Desk", startMin: 20, endMin: 200, assigned: incoming.id });
    await rejectsWith(db.rpc(incoming.uid, "assume_duty", [s]), "too_early");
  });

  test("check-in after the shift ended is rejected", async () => {
    const s = await db.shift(ws.id, { desk: "West Desk", startMin: -200, endMin: -1, assigned: incoming.id });
    await rejectsWith(db.rpc(incoming.uid, "assume_duty", [s]), "shift_ended");
  });

  test("wrong member (including the backup) is rejected", async () => {
    const s = await db.shift(ws.id, {
      desk: "South Desk",
      startMin: -5,
      endMin: 120,
      assigned: incoming.id,
      backup: stranger.id,
    });
    await rejectsWith(db.rpc(stranger.uid, "assume_duty", [s]), "not_assigned");
    await rejectsWith(db.rpc(outgoing.uid, "assume_duty", [s]), "not_assigned");
  });
});

describe("lead shift management", () => {
  let db: TestDb;
  let ws: Ws;
  let lead: M;
  let a: M;
  let b: M;
  let c: M;

  before(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace("Ops", "America/New_York");
    lead = await db.member(ws, "Lead_01", { role: "lead" });
    a = await db.member(ws, "Runner_A");
    b = await db.member(ws, "Runner_B");
    c = await db.member(ws, "Runner_C");
  });
  after(async () => db.close());

  test("creates a shift in the workspace time zone", async () => {
    const r = await db.rpc<{ shift_id: string; start_time: string; end_time: string }>(lead.uid, "lead_upsert_shift", [
      null,
      "Front Desk",
      "2030-07-01",
      "08:00",
      "12:00",
      a.id,
      b.id,
    ]);
    // EDT is UTC-4 in July.
    assert.equal(new Date(r.start_time).toISOString(), "2030-07-01T12:00:00.000Z");
    assert.equal(new Date(r.end_time).toISOString(), "2030-07-01T16:00:00.000Z");
  });

  test("overnight shifts roll into the next day", async () => {
    const r = await db.rpc<{ start_time: string; end_time: string }>(lead.uid, "lead_upsert_shift", [
      null,
      "Night Desk",
      "2030-07-01",
      "22:00",
      "06:00",
      c.id,
      null,
    ]);
    assert.equal(new Date(r.end_time).getTime() - new Date(r.start_time).getTime(), 8 * 3600_000);
  });

  test("DST: nonexistent local times are rejected; shifts spanning the change have true duration", async () => {
    // 2030-03-10 02:30 does not exist in America/New_York.
    await rejectsWith(
      db.rpc(lead.uid, "lead_upsert_shift", [null, "DST Desk", "2030-03-10", "02:30", "06:00", a.id, null]),
      "nonexistent_local_time",
    );
    const r = await db.rpc<{ start_time: string; end_time: string }>(lead.uid, "lead_upsert_shift", [
      null,
      "DST Desk",
      "2030-03-10",
      "00:00",
      "06:00",
      a.id,
      null,
    ]);
    assert.equal(new Date(r.end_time).getTime() - new Date(r.start_time).getTime(), 5 * 3600_000);
    const fallBack = await db.rpc<{ warnings: string[] }>(lead.uid, "lead_upsert_shift", [
      null,
      "DST Desk",
      "2030-11-03",
      "01:30",
      "05:00",
      b.id,
      null,
    ]);
    assert.deepEqual(fallBack.warnings, ["ambiguous_start_time"]);
  });

  test("overlapping shifts on the same desk are rejected", async () => {
    await rejectsWith(
      db.rpc(lead.uid, "lead_upsert_shift", [null, "Front Desk", "2030-07-01", "11:00", "13:00", c.id, null]),
      "desk_overlap",
    );
  });

  test("a primary cannot be double-booked across desks", async () => {
    await rejectsWith(
      db.rpc(lead.uid, "lead_upsert_shift", [null, "Side Desk", "2030-07-01", "10:00", "11:00", a.id, null]),
      "primary_conflict",
    );
    // b is backup on Front Desk 08-12 → cannot be primary elsewhere then.
    await rejectsWith(
      db.rpc(lead.uid, "lead_upsert_shift", [null, "Side Desk", "2030-07-01", "10:00", "11:00", b.id, null]),
      "primary_conflict",
    );
  });

  test("backup assignment is validated", async () => {
    await rejectsWith(
      db.rpc(lead.uid, "lead_upsert_shift", [null, "Side Desk", "2030-07-02", "10:00", "11:00", a.id, a.id]),
      "backup_equals_primary",
    );
    await rejectsWith(
      db.rpc(lead.uid, "lead_upsert_shift", [null, "Side Desk", "2030-07-01", "10:00", "11:00", c.id, a.id]),
      "backup_conflict",
    );
    await rejectsWith(
      db.rpc(lead.uid, "lead_upsert_shift", [
        null,
        "Side Desk",
        "2030-07-02",
        "10:00",
        "11:00",
        c.id,
        crypto.randomUUID(),
      ]),
      "backup_not_found",
    );
  });

  test("past shifts and invalid labels are rejected", async () => {
    await rejectsWith(
      db.rpc(lead.uid, "lead_upsert_shift", [null, "Front Desk", "2020-01-01", "08:00", "09:00", a.id, null]),
      "shift_in_past",
    );
    await rejectsWith(
      db.rpc(lead.uid, "lead_upsert_shift", [null, "   ", "2030-08-01", "08:00", "09:00", a.id, null]),
      "invalid_desk_label",
    );
  });

  test("editing a shift and reassigning resets check-in; delete works", async () => {
    const s = await db.shift(ws.id, { desk: "Edit Desk", startMin: -5, endMin: 60, assigned: a.id, checkedIn: true });
    const today = (
      await db.admin<{ d: string }>(
        "select to_char(now() at time zone 'America/New_York' + interval '2 days', 'YYYY-MM-DD') d",
      )
    )[0].d;
    await db.rpc(lead.uid, "lead_upsert_shift", [s, "Edit Desk", today, "09:00", "10:00", c.id, null]);
    const [row] = await db.admin<{ is_checked_in: boolean; assigned_member_id: string }>(
      "select * from public.shifts where id = $1",
      [s],
    );
    assert.equal(row.is_checked_in, false);
    assert.equal(row.assigned_member_id, c.id);
    assert.deepEqual(await db.rpc(lead.uid, "lead_delete_shift", [s]), { status: "deleted" });
  });

  test("lead_list_shifts includes callsigns", async () => {
    const list = await db.rpc<Array<{ assigned_callsign: string; backup_callsign: string | null; desk_label: string }>>(
      lead.uid,
      "lead_list_shifts",
      ["2030-07-01T00:00:00Z", "2030-07-03T00:00:00Z"],
    );
    const front = list.find((s) => s.desk_label === "Front Desk");
    assert.equal(front?.assigned_callsign, "Runner_A");
    assert.equal(front?.backup_callsign, "Runner_B");
  });
});

describe("bulk schedule import", () => {
  let db: TestDb;
  let ws: Ws;
  let lead: M;

  before(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace("Import", "America/Chicago");
    lead = await db.member(ws, "Lead_01", { role: "lead" });
    for (const cs of ["Runner_01", "Runner_02", "Runner_03", "Runner_05"]) await db.member(ws, cs);
  });
  after(async () => db.close());

  const row = (o: Record<string, unknown> = {}) => ({
    date: "2030-11-18",
    start_time: "08:00",
    end_time: "12:00",
    primary_callsign: "Runner_02",
    backup_callsign: "Runner_05",
    desk_label: "Front Desk",
    ...o,
  });

  test("preview validates without inserting", async () => {
    const r = await db.rpc<{ status: string; rows: Array<{ ok: boolean }> }>(lead.uid, "lead_import_shifts", [
      JSON.stringify([
        row(),
        row({ start_time: "12:00", end_time: "16:00", primary_callsign: "runner_03", backup_callsign: "Runner_01" }),
      ]),
      false,
    ]);
    // Runner_01 exists; callsigns are matched case-insensitively.
    assert.equal(r.status, "valid");
    assert.equal((await db.admin("select * from public.shifts")).length, 0);
  });

  test("invalid rows are reported per row and nothing is inserted (all-or-nothing)", async () => {
    const r = await db.rpc<{ status: string; rows: Array<{ index: number; ok: boolean; error?: string }> }>(
      lead.uid,
      "lead_import_shifts",
      [
        JSON.stringify([
          row(),
          row({ date: null, desk_label: "B" }),
          row({ primary_callsign: "Runner_99", desk_label: "C" }),
          row({ desk_label: "Front Desk", start_time: "10:00", primary_callsign: "Runner_03", backup_callsign: null }),
          { ...row({ desk_label: "D" }), assigned_member_id: "x" },
          row({ desk_label: "E", start_time: "8am" }),
        ]),
        true,
      ],
    );
    assert.equal(r.status, "invalid");
    assert.deepEqual(
      r.rows.map((x) => x.error ?? "ok"),
      ["ok", "missing_date", "unknown_primary_callsign", "desk_overlap", "unknown_field", "invalid_time"],
    );
    assert.equal((await db.admin("select * from public.shifts")).length, 0);
  });

  test("valid batch commits transactionally; replay is rejected by overlap checks", async () => {
    const rows = [
      row(),
      row({ start_time: "12:00", end_time: "16:00", primary_callsign: "Runner_03", backup_callsign: "Runner_01" }),
    ];
    const r = await db.rpc<{ status: string; imported_count: number }>(lead.uid, "lead_import_shifts", [
      JSON.stringify(rows),
      true,
    ]);
    assert.deepEqual([r.status, r.imported_count], ["imported", 2]);
    const [s] = await db.admin<{ start_time: Date }>(
      "select start_time from public.shifts order by start_time limit 1",
    );
    assert.equal(new Date(s.start_time).toISOString(), "2030-11-18T14:00:00.000Z"); // CST = UTC-6
    const replay = await db.rpc<{ status: string }>(lead.uid, "lead_import_shifts", [JSON.stringify(rows), true]);
    assert.equal(replay.status, "invalid");
    assert.equal((await db.admin("select * from public.shifts")).length, 2);
  });

  test("row count limits are enforced", async () => {
    await rejectsWith(db.rpc(lead.uid, "lead_import_shifts", [JSON.stringify([]), false]), "invalid_row_count");
    await rejectsWith(
      db.rpc(lead.uid, "lead_import_shifts", [JSON.stringify(Array(201).fill(row())), false]),
      "invalid_row_count",
    );
  });
});
