import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb, rejectsWith, uuid, type TestDb } from "./harness.ts";

describe("authorization & workspace isolation", () => {
  let db: TestDb;
  let wsA: { id: string; invite: string };
  let wsB: { id: string; invite: string };
  let memberA: { uid: string; id: string };
  let otherA: { uid: string; id: string };
  let leadA: { uid: string; id: string };
  let memberB: { uid: string; id: string };
  let leadB: { uid: string; id: string };
  let shiftOtherA: string;
  let shiftB: string;

  before(async () => {
    db = await createDb();
    wsA = await db.provisionWorkspace("Workspace A");
    wsB = await db.provisionWorkspace("Workspace B");
    memberA = await db.member(wsA, "Runner_A1");
    otherA = await db.member(wsA, "Runner_A2");
    leadA = await db.member(wsA, "Lead_A", { role: "lead" });
    memberB = await db.member(wsB, "Runner_B1");
    leadB = await db.member(wsB, "Lead_B", { role: "lead" });
    shiftOtherA = await db.shift(wsA.id, { startMin: -30, endMin: 90, assigned: otherA.id });
    shiftB = await db.shift(wsB.id, { startMin: -30, endMin: 90, assigned: memberB.id });
    await db.rpc(leadB.uid, "publish_top_alert", ["Workspace B only alert", "normal", uuid()]);
  });
  after(async () => db.close());

  test("member cannot view another workspace", async () => {
    const workspaces = await db.asUser(memberA.uid, "select id, name from public.workspaces");
    assert.deepEqual(
      workspaces.map((w) => w.id),
      [wsA.id],
    );
    const shifts = await db.asUser(memberA.uid, "select id from public.shifts where workspace_id = $1", [wsB.id]);
    assert.equal(shifts.length, 0);
    const pings = await db.asUser(memberA.uid, "select id from public.pings where workspace_id = $1", [wsB.id]);
    assert.equal(pings.length, 0);
    const members = await db.asUser(memberA.uid, "select id from public.members where workspace_id = $1", [wsB.id]);
    assert.equal(members.length, 0);
  });

  test("member cannot read the member directory or full roster", async () => {
    const members = await db.asUser(memberA.uid, "select id, callsign from public.members");
    assert.deepEqual(
      members.map((m) => m.id),
      [memberA.id],
    );
    const shifts = await db.asUser(memberA.uid, "select id from public.shifts");
    assert.equal(shifts.length, 0, "member sees no shifts they are not on");
    await rejectsWith(db.rpc(memberA.uid, "lead_list_members"), "not_authorized");
    await rejectsWith(
      db.rpc(memberA.uid, "lead_list_shifts", [new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]),
      "not_authorized",
    );
  });

  test("desk status never exposes member identity", async () => {
    const status = await db.asUser(memberA.uid, "select * from public.get_desk_status()");
    assert.equal(status.length, 1);
    assert.deepEqual(Object.keys(status[0]).sort(), ["desk_label", "ends_at", "status"]);
  });

  test("no one can read push tokens, auth ids, or invite codes through tables", async () => {
    await rejectsWith(db.asUser(memberA.uid, "select expo_push_token from public.members"), "permission denied");
    await rejectsWith(db.asUser(leadA.uid, "select expo_push_token from public.members"), "permission denied");
    await rejectsWith(db.asUser(leadA.uid, "select auth_uid from public.members"), "permission denied");
    await rejectsWith(db.asUser(memberA.uid, "select invite_code from public.workspaces"), "permission denied");
    await rejectsWith(db.asUser(memberA.uid, "select * from public.members"), "permission denied");
    const roster = await db.rpc<Array<Record<string, unknown>>>(leadA.uid, "lead_list_members");
    assert.ok(roster.every((m) => !("expo_push_token" in m) && typeof m.has_device === "boolean"));
  });

  test("member cannot promote themselves or write tables directly", async () => {
    await rejectsWith(
      db.asUser(memberA.uid, "update public.members set role = 'admin' where id = $1", [memberA.id]),
      "permission denied",
    );
    await rejectsWith(
      db.asUser(
        memberA.uid,
        "insert into public.members (auth_uid, workspace_id, callsign, role) values ($1, $2, 'Evil_01', 'admin')",
        [memberA.uid, wsA.id],
      ),
      "permission denied",
    );
    await rejectsWith(
      db.asUser(memberA.uid, "update public.shifts set assigned_member_id = $1", [memberA.id]),
      "permission denied",
    );
    await rejectsWith(db.asUser(memberA.uid, "delete from public.pings"), "permission denied");
    await rejectsWith(db.rpc(memberA.uid, "admin_set_member_role", [memberA.id, "admin"]), "not_authorized");
    await rejectsWith(db.rpc(leadA.uid, "admin_set_member_role", [leadA.id, "admin"]), "not_authorized");
    const [me] = await db.admin<{ role: string }>("select role from public.members where id = $1", [memberA.id]);
    assert.equal(me.role, "member");
  });

  test("member cannot publish a top alert or manage shifts", async () => {
    await rejectsWith(db.rpc(memberA.uid, "publish_top_alert", ["Fake alert", "critical", uuid()]), "not_authorized");
    await rejectsWith(
      db.rpc(memberA.uid, "lead_upsert_shift", [null, "Front Desk", "2030-01-01", "08:00", "12:00", memberA.id, null]),
      "not_authorized",
    );
    await rejectsWith(db.rpc(memberA.uid, "lead_delete_shift", [shiftOtherA]), "not_authorized");
    await rejectsWith(db.rpc(memberA.uid, "lead_import_shifts", [JSON.stringify([]), false]), "not_authorized");
    await rejectsWith(db.rpc(memberA.uid, "lead_get_invite"), "not_authorized");
  });

  test("private tables and service functions are unreachable for clients", async () => {
    await rejectsWith(db.asUser(leadA.uid, "select * from private.push_outbox"), "permission denied");
    await rejectsWith(db.asUser(leadA.uid, "select * from private.security_events"), "permission denied");
    await rejectsWith(db.asUser(leadA.uid, "select public.run_escalations()"), "permission denied");
    await rejectsWith(db.asUser(leadA.uid, "select * from public.svc_claim_push_batch(10)"), "permission denied");
    await rejectsWith(db.asUser(leadA.uid, "select public.purge_expired_data()"), "permission denied");
    await rejectsWith(
      db.asUser(leadA.uid, "select private.enqueue_push(null,null,null,'desk_ping','t','b','{}','k')"),
      "permission denied",
    );
  });

  test("lead sees own workspace scheduling data but never another workspace", async () => {
    const shifts = await db.asUser(leadA.uid, "select id, workspace_id from public.shifts");
    assert.ok(shifts.length >= 1);
    assert.ok(shifts.every((s) => s.workspace_id === wsA.id));
    assert.ok(!shifts.some((s) => s.id === shiftB));
    const alerts = await db.asUser(leadA.uid, "select id from public.pings where category = 'top_alert'");
    assert.equal(alerts.length, 0, "workspace B alert invisible to workspace A lead");
    await rejectsWith(db.rpc(leadA.uid, "lead_delete_shift", [shiftB]), "shift_not_found");
    await rejectsWith(
      db.rpc(leadA.uid, "lead_upsert_shift", [shiftB, "Front Desk", "2030-01-01", "08:00", "12:00", null, null]),
      "shift_not_found",
    );
    await rejectsWith(db.rpc(leadA.uid, "admin_set_member_role", [memberB.id, "lead"]), "not_authorized");
  });

  test("lead cannot assign a member from another workspace", async () => {
    await rejectsWith(
      db.rpc(leadA.uid, "lead_upsert_shift", [null, "North Desk", "2030-01-02", "08:00", "12:00", memberB.id, null]),
      "primary_not_found",
    );
    await rejectsWith(
      db.rpc(leadA.uid, "lead_upsert_shift", [
        null,
        "North Desk",
        "2030-01-02",
        "08:00",
        "12:00",
        memberA.id,
        memberB.id,
      ]),
      "backup_not_found",
    );
  });

  test("cross-workspace foreign keys are rejected at the schema level", async () => {
    await rejectsWith(
      db.shift(wsA.id, { startMin: 600, endMin: 700, assigned: memberB.id }),
      "violates foreign key constraint",
    );
    await rejectsWith(
      db.admin(
        "insert into public.pings (workspace_id, sender_member_id, target_shift_id, category, preset) values ($1, $2, $3, 'urgent_desk', 'urgent_issue')",
        [wsA.id, memberA.id, shiftB],
      ),
      "violates foreign key constraint",
    );
  });

  test("cross-workspace acknowledgment is indistinguishable from not found", async () => {
    const r = await db.rpc<{ ping_id: string }>(memberB.uid, "request_desk_ping", [
      "general_request",
      uuid(),
      null,
      null,
    ]);
    await rejectsWith(db.rpc(leadA.uid, "acknowledge_ping", [r.ping_id]), "ping_not_found");
  });
});
