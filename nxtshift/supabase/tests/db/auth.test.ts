import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb, rejectsWith, type TestDb } from "./harness.ts";

type JoinResult = { ok: boolean; error?: string; status?: string; member_id?: string; role?: string };

describe("authentication & onboarding", () => {
  let db: TestDb;
  let ws: { id: string; invite: string };

  before(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
  });
  after(async () => db.close());

  test("anonymous user joins with a valid invite as role=member", async () => {
    const uid = await db.createUser();
    const r = await db.svc<JoinResult>("svc_join_workspace", [uid, ws.invite.toLowerCase(), "Runner_Alpha"]);
    assert.equal(r.ok, true);
    assert.equal(r.status, "joined");
    assert.equal(r.role, "member");
    const ctx = await db.rpc<{ callsign: string; role: string }>(uid, "get_my_context");
    assert.equal(ctx.callsign, "Runner_Alpha");
    assert.equal(ctx.role, "member");
  });

  test("re-joining with the same identity and callsign is idempotent", async () => {
    const uid = await db.createUser();
    const first = await db.svc<JoinResult>("svc_join_workspace", [uid, ws.invite, "Desk_01"]);
    const second = await db.svc<JoinResult>("svc_join_workspace", [uid, ws.invite, "Desk_01"]);
    assert.equal(second.status, "existing");
    assert.equal(second.member_id, first.member_id);
  });

  test("an identity cannot hold a second membership", async () => {
    const other = await db.provisionWorkspace("Other");
    const uid = await db.createUser();
    await db.svc("svc_join_workspace", [uid, ws.invite, "Watch_03"]);
    const r = await db.svc<JoinResult>("svc_join_workspace", [uid, other.invite, "Watch_03"]);
    assert.deepEqual([r.ok, r.error], [false, "already_member"]);
  });

  test("invalid invite is rejected", async () => {
    const uid = await db.createUser();
    const r = await db.svc<JoinResult>("svc_join_workspace", [uid, "ZZZZZZ", "Nobody_1"]);
    assert.deepEqual([r.ok, r.error], [false, "invalid_invite"]);
    const malformed = await db.svc<JoinResult>("svc_join_workspace", [uid, "abc", "Nobody_1"]);
    assert.equal(malformed.error, "invalid_invite");
  });

  test("revoked and expired invites are rejected indistinguishably", async () => {
    const revoked = await db.provisionWorkspace("Revoked");
    await db.admin("update public.workspaces set invite_revoked_at = now() where id = $1", [revoked.id]);
    const expired = await db.provisionWorkspace("Expired");
    await db.admin("update public.workspaces set invite_expires_at = now() - interval '1 minute' where id = $1", [
      expired.id,
    ]);

    const uid = await db.createUser();
    const a = await db.svc<JoinResult>("svc_join_workspace", [uid, revoked.invite, "Late_01"]);
    const b = await db.svc<JoinResult>("svc_join_workspace", [uid, expired.invite, "Late_01"]);
    assert.equal(a.error, "invalid_invite");
    assert.equal(b.error, "invalid_invite");
  });

  test("duplicate callsign (case-insensitive) is rejected", async () => {
    await db.member(ws, "ShiftLead_02", { token: null });
    const uid = await db.createUser();
    const r = await db.svc<JoinResult>("svc_join_workspace", [uid, ws.invite, "shiftlead_02"]);
    assert.deepEqual([r.ok, r.error], [false, "callsign_taken"]);
  });

  test("invalid callsigns are rejected", async () => {
    const uid = await db.createUser();
    for (const bad of ["ab", "has space", "a".repeat(25), "emoji🙂"]) {
      const r = await db.svc<JoinResult>("svc_join_workspace", [uid, ws.invite, bad]);
      assert.equal(r.error, "invalid_callsign", bad);
    }
  });

  test("invite brute force is throttled per identity (failures are counted)", async () => {
    const uid = await db.createUser();
    const results: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await db.svc<JoinResult>("svc_join_workspace", [uid, "QQQQQQ", "Brute_01"]);
      results.push(r.error ?? "ok");
    }
    assert.deepEqual(results.slice(0, 10), Array(10).fill("invalid_invite"));
    assert.deepEqual(results.slice(10), ["rate_limited", "rate_limited"]);
    // Even a correct code is refused while throttled.
    const r = await db.svc<JoinResult>("svc_join_workspace", [uid, ws.invite, "Brute_01"]);
    assert.equal(r.error, "rate_limited");
  });

  test("join requires an existing auth identity", async () => {
    const r = await db.svc<JoinResult>("svc_join_workspace", [crypto.randomUUID(), ws.invite, "Ghost_01"]);
    assert.equal(r.error, "unauthenticated");
  });

  test("clients cannot call the service join function or provision workspaces", async () => {
    const uid = await db.createUser();
    await rejectsWith(
      db.asUser(uid, "select public.svc_join_workspace($1, $2, $3)", [uid, ws.invite, "Sneaky_01"]),
      "permission denied",
    );
    await rejectsWith(
      db.asAnon("select public.svc_join_workspace($1, $2, $3)", [uid, ws.invite, "Sneaky_01"]),
      "permission denied",
    );
    await rejectsWith(db.asUser(uid, "select public.svc_provision_workspace('Mine', 'UTC')"), "permission denied");
  });

  test("unauthenticated (anon) requests cannot use member RPCs or read tables", async () => {
    await rejectsWith(db.asAnon("select public.get_desk_status()"), "permission denied");
    await rejectsWith(
      db.asAnon("select public.request_desk_ping('urgent_issue', gen_random_uuid())"),
      "permission denied",
    );
    await rejectsWith(db.asAnon("select id from public.members"), "permission denied");
    await rejectsWith(db.asAnon("select id from public.pings"), "permission denied");
  });

  test("session restoration: an authenticated identity without membership gets null context", async () => {
    const uid = await db.createUser();
    assert.equal(await db.rpc(uid, "get_my_context"), null);
    await rejectsWith(db.rpc(uid, "get_desk_status"), "not_a_member");
  });

  test("leaving deletes the membership; last admin cannot leave", async () => {
    const w = await db.provisionWorkspace("Leave");
    const admin = await db.member(w, "Admin_01", { role: "admin" });
    const m = await db.member(w, "Leaver_01");
    assert.deepEqual(await db.rpc(m.uid, "leave_workspace"), { status: "left" });
    assert.equal(await db.rpc(m.uid, "get_my_context"), null);
    await rejectsWith(db.rpc(admin.uid, "leave_workspace"), "last_admin");
  });
});
