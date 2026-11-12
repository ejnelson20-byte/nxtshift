import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDb, rejectsWith, uuid, type TestDb } from "./harness.ts";

type Ws = { id: string; invite: string };
type M = { uid: string; id: string };
type Claimed = { id: string; kind: string; token: string; attempts: number };

describe("three-minute escalation", () => {
  let db: TestDb;
  let ws: Ws;
  let sender: M;
  let primary: M;
  let backup: M;
  let lead1: M;
  let lead2: M;
  let pingId: string;

  beforeEach(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
    sender = await db.member(ws, "Resident_01");
    primary = await db.member(ws, "Desk_01");
    backup = await db.member(ws, "Desk_02");
    lead1 = await db.member(ws, "Lead_01", { role: "lead" });
    lead2 = await db.member(ws, "Admin_01", { role: "admin" });
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id, backup: backup.id });
    const r = await db.rpc<{ ping_id: string }>(sender.uid, "request_desk_ping", ["urgent_issue", uuid(), null, null]);
    pingId = r.ping_id;
  });
  afterEach(async () => db.close());

  test("does not escalate before three minutes", async () => {
    await db.ageRows("public.pings", "created_at", pingId, 2);
    assert.equal(await db.svc("run_escalations"), 0);
  });

  test("unacknowledged ping escalates after three minutes to backup and every lead", async () => {
    await db.ageRows("public.pings", "created_at", pingId, 3);
    assert.equal(await db.svc("run_escalations"), 1);
    const outbox = await db.outbox(pingId);
    const recipients = outbox
      .filter((o) => o.kind !== "desk_ping")
      .map((o) => [o.kind, o.recipient_member_id])
      .sort();
    assert.deepEqual(
      recipients,
      [
        ["backup_escalation", backup.id],
        ["lead_escalation", lead1.id],
        ["lead_escalation", lead2.id],
      ].sort(),
    );
    const [ping] = await db.admin("select escalated_at from public.pings where id = $1", [pingId]);
    assert.ok(ping.escalated_at);
  });

  test("acknowledged ping does not escalate", async () => {
    const ack = await db.rpc<{ status: string }>(primary.uid, "acknowledge_ping", [pingId]);
    assert.equal(ack.status, "acknowledged");
    await db.ageRows("public.pings", "created_at", pingId, 5);
    assert.equal(await db.svc("run_escalations"), 0);
    const outbox = await db.outbox(pingId);
    assert.deepEqual(
      outbox.map((o) => [o.kind, o.status]),
      [["desk_ping", "cancelled"]],
    );
  });

  test("repeated or retried scheduler runs never duplicate escalation", async () => {
    await db.ageRows("public.pings", "created_at", pingId, 4);
    const results = await Promise.all([
      db.svc("run_escalations"),
      db.svc("run_escalations"),
      db.svc("run_escalations"),
    ]);
    assert.equal(
      results.reduce((a, b) => Number(a) + Number(b), 0),
      1,
    );
    assert.equal(await db.svc("run_escalations"), 0);
    // Direct re-invocation of the escalation primitive is also a no-op.
    await db.admin("select private.escalate_ping($1, 'retry')", [pingId]);
    assert.equal((await db.outbox(pingId)).filter((o) => o.kind !== "desk_ping").length, 3);
  });

  test("acknowledgment authorization: strangers rejected; backup only after escalation; leads any time", async () => {
    const stranger = await db.member(ws, "Stranger_1");
    await rejectsWith(db.rpc(stranger.uid, "acknowledge_ping", [pingId]), "not_authorized");
    await rejectsWith(db.rpc(sender.uid, "acknowledge_ping", [pingId]), "not_authorized");
    await rejectsWith(db.rpc(backup.uid, "acknowledge_ping", [pingId]), "not_authorized");
    await rejectsWith(db.rpc(primary.uid, "acknowledge_ping", [crypto.randomUUID()]), "ping_not_found");

    await db.ageRows("public.pings", "created_at", pingId, 3);
    await db.svc("run_escalations");
    const ack = await db.rpc<{ status: string }>(backup.uid, "acknowledge_ping", [pingId]);
    assert.equal(ack.status, "acknowledged");
    const again = await db.rpc<{ status: string }>(lead1.uid, "acknowledge_ping", [pingId]);
    assert.equal(again.status, "already_acknowledged");
    const [ping] = await db.admin("select acknowledged_by_member_id from public.pings where id = $1", [pingId]);
    assert.equal(ping.acknowledged_by_member_id, backup.id);
  });

  test("acknowledgment/escalation race: ack after escalation cancels unsent escalation pushes", async () => {
    await db.ageRows("public.pings", "created_at", pingId, 3);
    await db.svc("run_escalations");
    await db.rpc(primary.uid, "acknowledge_ping", [pingId]);
    const statuses = (await db.outbox(pingId)).map((o) => o.status);
    assert.ok(
      statuses.every((s) => s === "cancelled"),
      JSON.stringify(statuses),
    );
    const claimed = await db.asService<Claimed>("select * from public.svc_claim_push_batch(100)");
    assert.equal(claimed.length, 0);
  });

  test("escalation with nobody reachable is recorded", async () => {
    await db.admin("update public.members set expo_push_token = null where id <> $1", [sender.id]);
    await db.ageRows("public.pings", "created_at", pingId, 3);
    await db.svc("run_escalations");
    const events = await db.admin("select event from private.security_events where event like 'escalation%'");
    assert.deepEqual(
      events.map((e) => e.event),
      ["escalation_unreachable"],
    );
  });
});

describe("push outbox delivery semantics", () => {
  let db: TestDb;
  let ws: Ws;
  let primary: M;
  let pingId: string;

  beforeEach(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
    const sender = await db.member(ws, "Resident_01");
    primary = await db.member(ws, "Desk_01", { token: "ExponentPushToken[primaryToken123]" });
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id });
    pingId = (await db.rpc<{ ping_id: string }>(sender.uid, "request_desk_ping", ["urgent_issue", uuid(), null, null]))
      .ping_id;
  });
  afterEach(async () => db.close());

  test("claim leases rows exactly once and returns the current token", async () => {
    const first = await db.asService<Claimed>("select * from public.svc_claim_push_batch(10)");
    assert.equal(first.length, 1);
    assert.equal(first[0].token, "ExponentPushToken[primaryToken123]");
    assert.equal(first[0].attempts, 1);
    const second = await db.asService<Claimed>("select * from public.svc_claim_push_batch(10)");
    assert.equal(second.length, 0, "leased rows are not handed to a concurrent dispatcher");
  });

  test("accepted ticket is not treated as delivery; receipt ok → provider_ok", async () => {
    const [c] = await db.asService<Claimed>("select * from public.svc_claim_push_batch(10)");
    await db.svc("svc_record_push_results", [
      JSON.stringify([{ id: c.id, outcome: "accepted", ticket_id: "ticket-1" }]),
    ]);
    let [row] = await db.outbox(pingId);
    assert.equal(row.status, "accepted");
    await db.admin("update private.push_outbox set updated_at = now() - interval '1 minute'");
    const receipts = await db.asService<{ id: string; ticket_id: string }>(
      "select * from public.svc_claim_receipt_batch(10)",
    );
    assert.deepEqual(
      receipts.map((r) => r.ticket_id),
      ["ticket-1"],
    );
    await db.svc("svc_record_receipts", [JSON.stringify([{ id: c.id, outcome: "ok" }])]);
    [row] = await db.outbox(pingId);
    assert.equal(row.status, "provider_ok");
  });

  test("failed dispatch is retryable with backoff and gives up after 5 attempts", async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claimed = await db.asService<Claimed>("select * from public.svc_claim_push_batch(10)");
      assert.equal(claimed.length, 1, `attempt ${attempt} claimable`);
      await db.svc("svc_record_push_results", [
        JSON.stringify([{ id: claimed[0].id, outcome: "retry", error: "network_error" }]),
      ]);
      const [row] = await db.outbox(pingId);
      if (attempt < 5) {
        assert.equal(row.status, "pending");
        assert.ok(new Date(row.next_attempt_at as string) > new Date(), "backoff scheduled in the future");
        await db.admin("update private.push_outbox set next_attempt_at = now()");
      } else {
        assert.equal(row.status, "failed");
      }
    }
  });

  test("expired dispatcher lease is reclaimed (crash recovery)", async () => {
    await db.asService("select * from public.svc_claim_push_batch(10)");
    await db.admin("update private.push_outbox set locked_until = now() - interval '1 second'");
    const reclaimed = await db.asService<Claimed>("select * from public.svc_claim_push_batch(10)");
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0].attempts, 2);
  });

  test("DeviceNotRegistered clears the token only if it is still the same token", async () => {
    const [c] = await db.asService<Claimed>("select * from public.svc_claim_push_batch(10)");
    await db.svc("svc_record_push_results", [JSON.stringify([{ id: c.id, outcome: "device_not_registered" }])]);
    const [m] = await db.admin<{ expo_push_token: string | null }>(
      "select expo_push_token from public.members where id = $1",
      [primary.id],
    );
    assert.equal(m.expo_push_token, null);
  });

  test("a re-registered token is not cleared by a stale DeviceNotRegistered", async () => {
    const [c] = await db.asService<Claimed>("select * from public.svc_claim_push_batch(10)");
    await db.rpc(primary.uid, "register_push_token", ["ExponentPushToken[newTokenAfterReinstall]"]);
    await db.svc("svc_record_push_results", [JSON.stringify([{ id: c.id, outcome: "device_not_registered" }])]);
    const [m] = await db.admin<{ expo_push_token: string | null }>(
      "select expo_push_token from public.members where id = $1",
      [primary.id],
    );
    assert.equal(m.expo_push_token, "ExponentPushToken[newTokenAfterReinstall]");
  });

  test("registering a token moves it off any abandoned membership", async () => {
    const other = await db.member(ws, "Reinstall_1", { token: null });
    await db.rpc(other.uid, "register_push_token", ["ExponentPushToken[primaryToken123]"]);
    const rows = await db.admin<{ id: string }>(
      "select id from public.members where expo_push_token = 'ExponentPushToken[primaryToken123]'",
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [other.id],
    );
    await rejectsWith(db.rpc(other.uid, "register_push_token", ["not-a-token"]), "invalid_push_token");
  });
});
