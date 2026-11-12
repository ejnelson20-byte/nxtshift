import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDb, rejectsWith, uuid, type TestDb } from "./harness.ts";

type Ws = { id: string; invite: string };
type M = { uid: string; id: string };
type PingResult = {
  status: string;
  ping_id: string;
  desk_label: string;
  escalation: string;
  escalation_recipients_queued: number;
};

describe("ping routing", () => {
  let db: TestDb;
  let ws: Ws;
  let sender: M;
  let primary: M;
  let backup: M;
  let lead: M;

  beforeEach(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
    sender = await db.member(ws, "Resident_01");
    primary = await db.member(ws, "Desk_01");
    backup = await db.member(ws, "Desk_02");
    lead = await db.member(ws, "Lead_01", { role: "lead" });
  });
  afterEach(async () => db.close());

  test("routes to the active shift's primary and returns no identity", async () => {
    const shiftId = await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id, backup: backup.id });
    await db.shift(ws.id, { startMin: 60, endMin: 180, assigned: backup.id });

    const r = await db.rpc<PingResult>(sender.uid, "request_desk_ping", [
      "urgent_issue",
      uuid(),
      null,
      "Water leak in lobby",
    ]);
    assert.equal(r.status, "routed");
    assert.equal(r.escalation, "scheduled");
    assert.equal(r.desk_label, "Front Desk");
    assert.ok(!JSON.stringify(r).includes("Desk_01"), "no callsign leaks to sender");

    const [ping] = await db.admin("select * from public.pings where id = $1", [r.ping_id]);
    assert.equal(ping.target_shift_id, shiftId);
    assert.equal(ping.category, "urgent_desk");
    const outbox = await db.outbox(r.ping_id);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].recipient_member_id, primary.id);
    assert.equal(outbox[0].category_id, "NXTSHIFT_PING");
    assert.ok(!String(outbox[0].body).includes("Water leak"), "free-text notes are never placed in push payloads");
  });

  test("presets map to supported categories", async () => {
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id });
    const expected: Record<string, string> = {
      front_door: "urgent_desk",
      urgent_issue: "urgent_desk",
      supervisor_check: "relief_check",
      general_request: "relief_check",
    };
    for (const [preset, category] of Object.entries(expected)) {
      const r = await db.rpc<PingResult>(sender.uid, "request_desk_ping", [preset, uuid(), null, null]);
      const [ping] = await db.admin<{ category: string }>("select category from public.pings where id = $1", [
        r.ping_id,
      ]);
      assert.equal(ping.category, category, preset);
      assert.equal(r.escalation, category === "urgent_desk" ? "scheduled" : "none");
    }
  });

  test("no active shift returns a clear error and routes nowhere", async () => {
    await db.shift(ws.id, { startMin: 30, endMin: 90, assigned: primary.id });
    await rejectsWith(db.rpc(sender.uid, "request_desk_ping", ["urgent_issue", uuid(), null, null]), "no_active_shift");
    assert.equal((await db.admin("select * from public.pings")).length, 0);
    assert.equal((await db.outbox()).length, 0);
  });

  test("multiple overlapping shifts on a desk: checked-in shift wins, then the later start", async () => {
    const early = await db.shift(ws.id, { startMin: -120, endMin: 30, assigned: backup.id });
    const late = await db.shift(ws.id, { startMin: -10, endMin: 120, assigned: primary.id });
    let r = await db.rpc<PingResult>(sender.uid, "request_desk_ping", ["general_request", uuid(), null, null]);
    let [ping] = await db.admin("select target_shift_id from public.pings where id = $1", [r.ping_id]);
    assert.equal(ping.target_shift_id, late);

    await db.admin("update public.shifts set is_checked_in = true where id = $1", [early]);
    r = await db.rpc<PingResult>(sender.uid, "request_desk_ping", ["general_request", uuid(), null, null]);
    [ping] = await db.admin("select target_shift_id from public.pings where id = $1", [r.ping_id]);
    assert.equal(ping.target_shift_id, early);
  });

  test("multiple active desks require an explicit desk selection", async () => {
    await db.shift(ws.id, { desk: "Front Desk", startMin: -10, endMin: 60, assigned: primary.id });
    await db.shift(ws.id, { desk: "North Desk", startMin: -10, endMin: 60, assigned: backup.id });
    await rejectsWith(
      db.rpc(sender.uid, "request_desk_ping", ["urgent_issue", uuid(), null, null]),
      "desk_selection_required",
    );
    const r = await db.rpc<PingResult>(sender.uid, "request_desk_ping", ["urgent_issue", uuid(), "North Desk", null]);
    assert.equal(r.desk_label, "North Desk");
    await rejectsWith(
      db.rpc(sender.uid, "request_desk_ping", ["urgent_issue", uuid(), "Nonexistent", null]),
      "no_active_shift",
    );
  });

  test("invalid category and oversize notes are rejected", async () => {
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id });
    await rejectsWith(db.rpc(sender.uid, "request_desk_ping", ["top_alert", uuid(), null, null]), "invalid_category");
    await rejectsWith(db.rpc(sender.uid, "request_desk_ping", ["nuke", uuid(), null, null]), "invalid_category");
    await rejectsWith(
      db.rpc(sender.uid, "request_desk_ping", ["urgent_issue", uuid(), null, "x".repeat(141)]),
      "note_too_long",
    );
    await rejectsWith(
      db.rpc(sender.uid, "request_desk_ping", ["urgent_issue", null, null, null]),
      "missing_request_id",
    );
  });

  test("duplicate requests (same client request id) do not create a second ping", async () => {
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id });
    const id = uuid();
    const a = await db.rpc<PingResult>(sender.uid, "request_desk_ping", ["urgent_issue", id, null, null]);
    const b = await db.rpc<PingResult>(sender.uid, "request_desk_ping", ["urgent_issue", id, null, null]);
    assert.equal(b.status, "duplicate");
    assert.equal(b.ping_id, a.ping_id);
    assert.equal((await db.admin("select * from public.pings")).length, 1);
    assert.equal((await db.outbox()).length, 1);
  });

  test("missing primary push token escalates immediately to backup and leads", async () => {
    await db.admin("update public.members set expo_push_token = null where id = $1", [primary.id]);
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id, backup: backup.id });
    const r = await db.rpc<PingResult>(sender.uid, "request_desk_ping", ["urgent_issue", uuid(), null, null]);
    assert.equal(r.escalation, "immediate");
    assert.equal(r.escalation_recipients_queued, 2);
    const outbox = await db.outbox(r.ping_id);
    const byKind = Object.fromEntries(outbox.map((o) => [o.kind as string, o]));
    assert.equal(byKind.desk_ping.status, "no_device");
    assert.equal(byKind.backup_escalation.recipient_member_id, backup.id);
    assert.equal(byKind.lead_escalation.recipient_member_id, lead.id);
    const [ping] = await db.admin("select escalated_at from public.pings where id = $1", [r.ping_id]);
    assert.ok(ping.escalated_at);
  });

  test("unstaffed active shift escalates immediately", async () => {
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: null, backup: backup.id });
    const r = await db.rpc<PingResult>(sender.uid, "request_desk_ping", ["front_door", uuid(), null, null]);
    assert.equal(r.escalation, "immediate");
  });

  test("ping visibility: sender and primary see it; backup only after escalation; others never", async () => {
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id, backup: backup.id });
    const r = await db.rpc<PingResult>(sender.uid, "request_desk_ping", ["urgent_issue", uuid(), null, "note"]);
    const q = "select id from public.pings where id = $1";
    const bystander = await db.member(ws, "Bystander_1");
    assert.equal((await db.asUser(sender.uid, q, [r.ping_id])).length, 1);
    assert.equal((await db.asUser(primary.uid, q, [r.ping_id])).length, 1);
    assert.equal((await db.asUser(lead.uid, q, [r.ping_id])).length, 1);
    assert.equal((await db.asUser(backup.uid, q, [r.ping_id])).length, 0);
    assert.equal((await db.asUser(bystander.uid, q, [r.ping_id])).length, 0);
    await db.admin("update public.pings set escalated_at = now() where id = $1", [r.ping_id]);
    assert.equal((await db.asUser(backup.uid, q, [r.ping_id])).length, 1);
  });

  test("ping requests are rate limited per member", async () => {
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id });
    for (let i = 0; i < 6; i++) await db.rpc(sender.uid, "request_desk_ping", ["general_request", uuid(), null, null]);
    await rejectsWith(db.rpc(sender.uid, "request_desk_ping", ["general_request", uuid(), null, null]), "rate_limited");
  });
});

describe("top alerts", () => {
  let db: TestDb;
  let ws: Ws;
  let lead: M;
  let member: M;

  beforeEach(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
    lead = await db.member(ws, "Lead_01", { role: "lead" });
    member = await db.member(ws, "Runner_01");
    await db.member(ws, "Runner_02", { token: null });
  });
  afterEach(async () => db.close());

  test("lead publishes; fan-out excludes sender and token-less members; members can read it", async () => {
    const r = await db.rpc<{ status: string; ping_id: string; recipients_queued: number }>(
      lead.uid,
      "publish_top_alert",
      ["Updated weekend shift coverage", "high", uuid()],
    );
    assert.equal(r.status, "published");
    assert.equal(r.recipients_queued, 1);
    const rows = await db.asUser(member.uid, "select message, priority from public.pings where category = 'top_alert'");
    assert.deepEqual(rows, [{ message: "Updated weekend shift coverage", priority: "high" }]);
    const outbox = await db.outbox(r.ping_id);
    assert.ok(!String(outbox[0].body).includes("weekend"), "alert text is not sent through push providers");
  });

  test("message length, priority, idempotency and rate limits are enforced", async () => {
    await rejectsWith(db.rpc(lead.uid, "publish_top_alert", ["hi", "normal", uuid()]), "invalid_message_length");
    await rejectsWith(
      db.rpc(lead.uid, "publish_top_alert", ["x".repeat(281), "normal", uuid()]),
      "invalid_message_length",
    );
    await rejectsWith(db.rpc(lead.uid, "publish_top_alert", ["Valid text", "extreme", uuid()]), "invalid_priority");
    const id = uuid();
    const a = await db.rpc<{ ping_id: string }>(lead.uid, "publish_top_alert", ["Alert one", "normal", id]);
    const dup = await db.rpc<{ status: string; ping_id: string }>(lead.uid, "publish_top_alert", [
      "Alert one",
      "normal",
      id,
    ]);
    assert.deepEqual([dup.status, dup.ping_id], ["duplicate", a.ping_id]);
    await db.rpc(lead.uid, "publish_top_alert", ["Alert two", "normal", uuid()]);
    await db.rpc(lead.uid, "publish_top_alert", ["Alert three", "normal", uuid()]);
    await rejectsWith(db.rpc(lead.uid, "publish_top_alert", ["Alert four", "normal", uuid()]), "rate_limited");
  });

  test("top alerts cannot be acknowledged; leads can retract", async () => {
    const r = await db.rpc<{ ping_id: string }>(lead.uid, "publish_top_alert", ["Retract me", "normal", uuid()]);
    await rejectsWith(db.rpc(lead.uid, "acknowledge_ping", [r.ping_id]), "not_acknowledgeable");
    assert.deepEqual(await db.rpc(lead.uid, "lead_retract_top_alert", [r.ping_id]), { status: "retracted" });
    assert.equal((await db.outbox(r.ping_id)).length, 0, "dependent outbox rows removed with the alert");
  });
});
