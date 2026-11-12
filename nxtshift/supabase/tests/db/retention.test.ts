import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb, uuid, type TestDb } from "./harness.ts";

describe("ephemeral data retention", () => {
  let db: TestDb;
  let oldPing: string;
  let recentPing: string;
  let oldAlert: string;
  let recentAlert: string;
  let member: { uid: string; id: string };

  before(async () => {
    db = await createDb();
    const ws = await db.provisionWorkspace();
    const lead = await db.member(ws, "Lead_01", { role: "lead" });
    const primary = await db.member(ws, "Desk_01");
    member = await db.member(ws, "Runner_01");
    await db.shift(ws.id, { startMin: -60, endMin: 60, assigned: primary.id });

    oldPing = (
      await db.rpc<{ ping_id: string }>(member.uid, "request_desk_ping", ["general_request", uuid(), null, "old note"])
    ).ping_id;
    recentPing = (
      await db.rpc<{ ping_id: string }>(member.uid, "request_desk_ping", ["general_request", uuid(), null, null])
    ).ping_id;
    oldAlert = (await db.rpc<{ ping_id: string }>(lead.uid, "publish_top_alert", ["Old alert text", "normal", uuid()]))
      .ping_id;
    recentAlert = (
      await db.rpc<{ ping_id: string }>(lead.uid, "publish_top_alert", ["Fresh alert text", "normal", uuid()])
    ).ping_id;

    for (const id of [oldPing, oldAlert]) {
      await db.ageRows("public.pings", "created_at", id, 24 * 60 + 1);
      await db.admin(
        "update private.push_outbox set created_at = created_at - interval '24 hours 1 minute' where ping_id = $1",
        [id],
      );
    }
    await db.admin("update private.rate_limits set window_start = window_start - interval '2 days'");
  });
  after(async () => db.close());

  test("expired top alerts are hidden by RLS before the purge runs", async () => {
    const alerts = await db.asUser(member.uid, "select id from public.pings where category = 'top_alert'");
    assert.deepEqual(
      alerts.map((a) => a.id),
      [recentAlert],
    );
    const own = await db.asUser(member.uid, "select id from public.pings where category <> 'top_alert'");
    assert.deepEqual(
      own.map((a) => a.id),
      [recentPing],
    );
  });

  test("purge removes pings/alerts older than 24h and keeps recent ones", async () => {
    const counts = await db.svc<Record<string, number>>("purge_expired_data");
    assert.equal(counts.pings, 2);
    const remaining = await db.admin<{ id: string }>("select id from public.pings order by created_at");
    assert.deepEqual(remaining.map((r) => r.id).sort(), [recentPing, recentAlert].sort());
  });

  test("dependent outbox rows, rate-limit counters and payload copies are purged", async () => {
    assert.equal((await db.outbox(oldPing)).length, 0);
    assert.equal((await db.outbox(oldAlert)).length, 0);
    assert.ok((await db.outbox(recentPing)).length > 0);
    assert.equal((await db.admin("select * from private.rate_limits")).length, 0);
    const notes = await db.admin("select * from public.pings where message = 'old note'");
    assert.equal(notes.length, 0, "free-text note is gone");
  });

  test("handoff-only outbox rows (no ping) also expire", async () => {
    const [{ id }] = await db.admin<{ id: string }>(
      `insert into private.push_outbox (workspace_id, recipient_member_id, kind, title, body, dedupe_key, created_at)
       select workspace_id, id, 'shift_handoff', 't', 'b', 'test-handoff', now() - interval '25 hours' from public.members limit 1
       returning id`,
    );
    await db.svc("purge_expired_data");
    assert.equal((await db.admin("select * from private.push_outbox where id = $1", [id])).length, 0);
  });
});
