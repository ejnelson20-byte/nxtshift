import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDb, uuid, type TestDb } from "../db/harness.ts";
import { baseDeps, mockExpo, post } from "./support.ts";
import { createRouteDeskPingHandler } from "../../functions/route-desk-ping/handler.ts";
import { createJoinHandler } from "../../functions/join-workspace/handler.ts";
import { createPublishTopAlertHandler } from "../../functions/publish-top-alert/handler.ts";
import { createDispatchHandler } from "../../functions/dispatch-push/handler.ts";

type Ws = { id: string; invite: string };
type M = { uid: string; id: string };
const CRON_SECRET = "s".repeat(48);

describe("route-desk-ping", () => {
  let db: TestDb;
  let ws: Ws;
  let sender: M;
  let primary: M;
  let expo: ReturnType<typeof mockExpo>;

  beforeEach(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
    sender = await db.member(ws, "Resident_01");
    primary = await db.member(ws, "Desk_01");
    await db.shift(ws.id, { startMin: -30, endMin: 60, assigned: primary.id });
    expo = mockExpo();
  });
  afterEach(async () => db.close());

  test("requires authentication", async () => {
    const res = await createRouteDeskPingHandler(baseDeps(db, expo.fetch))(
      post({ preset: "urgent_issue", client_request_id: uuid() }),
    );
    assert.equal(res.status, 401);
  });

  test("rejects unknown fields and invalid categories", async () => {
    const handler = createRouteDeskPingHandler(baseDeps(db, expo.fetch));
    let res = await handler(
      post({ preset: "urgent_issue", client_request_id: uuid(), workspace_id: ws.id }, { uid: sender.uid }),
    );
    assert.deepEqual([res.status, (await res.json()).error], [400, "unknown_field"]);
    res = await handler(post({ preset: "top_alert", client_request_id: uuid() }, { uid: sender.uid }));
    assert.deepEqual([res.status, (await res.json()).error], [400, "invalid_category"]);
    res = await handler(post("[1,2]", { uid: sender.uid }));
    assert.equal(res.status, 400);
  });

  test("routes, dispatches immediately, reports provider acceptance (not delivery) and hides identity", async () => {
    const res = await createRouteDeskPingHandler(baseDeps(db, expo.fetch))(
      post({ preset: "urgent_issue", client_request_id: uuid(), note: "Lobby flood" }, { uid: sender.uid }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "routed");
    assert.equal(body.dispatch, "accepted_by_push_service");
    assert.ok(!JSON.stringify(body).includes("Desk_01"));

    const [msg] = expo.sent();
    assert.equal(msg.categoryId, "NXTSHIFT_PING");
    assert.equal(msg.channelId, "urgent");
    assert.match(String(msg.to), /^ExponentPushToken\[/);
    assert.ok(!JSON.stringify(msg).includes("Lobby flood"), "note never sent to push provider");
    const [row] = await db.outbox(body.ping_id);
    assert.equal(row.status, "accepted");
  });

  test("Expo outage leaves the push queued for retry instead of failing the request", async () => {
    expo.onSend(() => new Response("upstream down", { status: 503 }));
    const res = await createRouteDeskPingHandler(baseDeps(db, expo.fetch))(
      post({ preset: "urgent_issue", client_request_id: uuid() }, { uid: sender.uid }),
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.dispatch, "queued");
    const [row] = await db.outbox(body.ping_id);
    assert.equal(row.status, "pending");
    assert.equal(row.last_error, "http_503");
  });

  test("network failure is retryable", async () => {
    const failingFetch = async () => {
      throw new TypeError("network down");
    };
    const res = await createRouteDeskPingHandler(baseDeps(db, failingFetch))(
      post({ preset: "urgent_issue", client_request_id: uuid() }, { uid: sender.uid }),
    );
    const body = await res.json();
    const [row] = await db.outbox(body.ping_id);
    assert.deepEqual([row.status, row.last_error], ["pending", "network_error"]);
  });

  test("no active shift maps to 409 without routing", async () => {
    await db.admin("delete from public.shifts");
    const res = await createRouteDeskPingHandler(baseDeps(db, expo.fetch))(
      post({ preset: "urgent_issue", client_request_id: uuid() }, { uid: sender.uid }),
    );
    assert.deepEqual([res.status, (await res.json()).error], [409, "no_active_shift"]);
    assert.equal(expo.calls.length, 0);
  });

  test("duplicate request is not dispatched twice", async () => {
    const handler = createRouteDeskPingHandler(baseDeps(db, expo.fetch));
    const id = uuid();
    await handler(post({ preset: "urgent_issue", client_request_id: id }, { uid: sender.uid }));
    const res = await handler(post({ preset: "urgent_issue", client_request_id: id }, { uid: sender.uid }));
    assert.equal((await res.json()).status, "duplicate");
    assert.equal(expo.sent().length, 1);
  });
});

describe("join-workspace", () => {
  let db: TestDb;
  let ws: Ws;

  beforeEach(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
  });
  afterEach(async () => db.close());

  const handler = (d: TestDb) => createJoinHandler({ ...baseDeps(d, mockExpo().fetch), rateLimitSalt: "test-salt" });

  test("joins with a verified session; the role cannot be chosen by the client", async () => {
    const uid = await db.createUser();
    let res = await handler(db)(post({ invite_code: ws.invite, callsign: "Runner_Alpha", role: "admin" }, { uid }));
    assert.deepEqual([res.status, (await res.json()).error], [400, "unknown_field"]);
    res = await handler(db)(post({ invite_code: ws.invite.toLowerCase(), callsign: "Runner_Alpha" }, { uid }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).role, "member");
  });

  test("maps errors: invalid invite, duplicate callsign, unauthenticated", async () => {
    const a = await db.createUser();
    const b = await db.createUser();
    assert.equal((await handler(db)(post({ invite_code: "ZZZZZZ", callsign: "Runner_01" }, { uid: a }))).status, 400);
    await handler(db)(post({ invite_code: ws.invite, callsign: "Runner_01" }, { uid: a }));
    const dup = await handler(db)(post({ invite_code: ws.invite, callsign: "RUNNER_01" }, { uid: b }));
    assert.deepEqual([dup.status, (await dup.json()).error], [409, "callsign_taken"]);
    assert.equal((await handler(db)(post({ invite_code: ws.invite, callsign: "Runner_02" }))).status, 401);
  });

  test("per-IP rate limit blocks distributed identities from one address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const uid = await db.createUser();
      const res = await handler(db)(
        post(
          { invite_code: "QQQQQQ", callsign: `Brute_${i}x` },
          { uid, headers: { "x-forwarded-for": "203.0.113.7" } },
        ),
      );
      statuses.push(res.status);
    }
    assert.equal(statuses.filter((s) => s === 400).length, 20);
    assert.equal(statuses.at(-1), 429);
    const raw = await db.admin<{ bucket: string }>(
      "select bucket from private.rate_limits where bucket like 'join:ip:%'",
    );
    assert.ok(
      raw.every((r) => !r.bucket.includes("203.0.113.7")),
      "raw IP is never stored",
    );
  });
});

describe("publish-top-alert", () => {
  let db: TestDb;
  let ws: Ws;

  beforeEach(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
  });
  afterEach(async () => db.close());

  test("members are rejected; leads publish with a recipient count only", async () => {
    const expo = mockExpo();
    const member = await db.member(ws, "Runner_01");
    const lead = await db.member(ws, "Lead_01", { role: "lead" });
    await db.member(ws, "Runner_02");
    const handler = createPublishTopAlertHandler(baseDeps(db, expo.fetch));

    const denied = await handler(
      post({ message: "Fake", priority: "high", client_request_id: uuid() }, { uid: member.uid }),
    );
    assert.deepEqual([denied.status, (await denied.json()).error], [403, "not_authorized"]);

    const res = await handler(
      post(
        { message: "New handoff procedure effective tomorrow", priority: "high", client_request_id: uuid() },
        { uid: lead.uid },
      ),
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.recipients_queued, 2);
    assert.deepEqual(Object.keys(body).sort(), ["ping_id", "recipients_queued", "status"]);
    assert.equal(expo.sent().length, 2);
  });
});

describe("dispatch-push (scheduled escalation worker)", () => {
  let db: TestDb;
  let ws: Ws;
  let sender: M;
  let primary: M;
  let backup: M;
  let lead: M;
  let expo: ReturnType<typeof mockExpo>;

  beforeEach(async () => {
    db = await createDb();
    ws = await db.provisionWorkspace();
    sender = await db.member(ws, "Resident_01");
    primary = await db.member(ws, "Desk_01");
    backup = await db.member(ws, "Desk_02");
    lead = await db.member(ws, "Lead_01", { role: "lead" });
    await db.shift(ws.id, { startMin: -30, endMin: 60, assigned: primary.id, backup: backup.id });
    expo = mockExpo();
  });
  afterEach(async () => db.close());

  const dispatcher = () => createDispatchHandler({ ...baseDeps(db, expo.fetch), cronSecret: CRON_SECRET });
  const cron = (secret = CRON_SECRET) => post({}, { headers: { "x-nxtshift-cron-secret": secret } });

  test("rejects calls without the cron secret", async () => {
    assert.equal((await dispatcher()(cron("wrong"))).status, 401);
    assert.equal((await dispatcher()(post({}))).status, 401);
    const weak = createDispatchHandler({ ...baseDeps(db, expo.fetch), cronSecret: "short" });
    assert.equal((await weak(cron("short"))).status, 401, "weak secrets are refused");
  });

  test("end-to-end: unacknowledged urgent ping escalates to backup and lead after 3 minutes", async () => {
    const route = createRouteDeskPingHandler(baseDeps(db, expo.fetch));
    const routed = await (
      await route(post({ preset: "urgent_issue", client_request_id: uuid() }, { uid: sender.uid }))
    ).json();
    assert.equal(expo.sent().length, 1);

    // Before 3 minutes: nothing to escalate.
    let res = await (await dispatcher()(cron())).json();
    assert.equal(res.escalated, 0);

    await db.ageRows("public.pings", "created_at", routed.ping_id, 3);
    res = await (await dispatcher()(cron())).json();
    assert.equal(res.escalated, 1);
    const kinds = expo
      .sent()
      .slice(1)
      .map((m) => (m.data as { type: string }).type)
      .sort();
    assert.deepEqual(kinds, ["backup_escalation", "lead_escalation"]);
    assert.ok(
      expo
        .sent()
        .slice(1)
        .every((m) => m.categoryId === "NXTSHIFT_PING"),
    );

    // A retried scheduler run does not escalate or send again.
    res = await (await dispatcher()(cron())).json();
    assert.equal(res.escalated, 0);
    assert.equal(res.claimed, 0);
  });

  test("acknowledged ping is never escalated by the worker", async () => {
    const route = createRouteDeskPingHandler(baseDeps(db, expo.fetch));
    const routed = await (
      await route(post({ preset: "urgent_issue", client_request_id: uuid() }, { uid: sender.uid }))
    ).json();
    await db.rpc(primary.uid, "acknowledge_ping", [routed.ping_id]);
    await db.ageRows("public.pings", "created_at", routed.ping_id, 10);
    const res = await (await dispatcher()(cron())).json();
    assert.equal(res.escalated, 0);
    assert.equal(expo.sent().length, 1);
    void lead;
  });

  test("invalid push token (DeviceNotRegistered) clears the token; receipts are recorded", async () => {
    expo.onSend((messages) =>
      Response.json({ data: messages.map(() => ({ status: "error", details: { error: "DeviceNotRegistered" } })) }),
    );
    const route = createRouteDeskPingHandler(baseDeps(db, expo.fetch));
    await route(post({ preset: "general_request", client_request_id: uuid() }, { uid: sender.uid }));
    const [m] = await db.admin<{ expo_push_token: string | null }>(
      "select expo_push_token from public.members where id = $1",
      [primary.id],
    );
    assert.equal(m.expo_push_token, null);

    // Receipts path: accepted → provider_ok.
    expo.onSend((messages) => Response.json({ data: messages.map((_, i) => ({ status: "ok", id: `t-${i}` })) }));
    const lead2 = await db.member(ws, "Lead_02", { role: "lead" });
    await createPublishTopAlertHandler(baseDeps(db, expo.fetch))(
      post({ message: "Receipt check", priority: "normal", client_request_id: uuid() }, { uid: lead2.uid }),
    );
    await db.admin("update private.push_outbox set updated_at = now() - interval '1 minute' where status = 'accepted'");
    const res = await (await dispatcher()(cron())).json();
    assert.ok(res.receipts_checked > 0);
    const statuses = await db.admin<{ status: string }>(
      "select distinct status from private.push_outbox where kind = 'top_alert'",
    );
    assert.deepEqual(
      statuses.map((s) => s.status),
      ["provider_ok"],
    );
  });

  test("Expo rate limiting (429) keeps escalation pushes retryable", async () => {
    await db.admin("update public.members set expo_push_token = null where id = $1", [primary.id]);
    expo.onSend(() => new Response("slow down", { status: 429 }));
    const route = createRouteDeskPingHandler(baseDeps(db, expo.fetch));
    const routed = await (
      await route(post({ preset: "urgent_issue", client_request_id: uuid() }, { uid: sender.uid }))
    ).json();
    assert.equal(routed.escalation, "immediate");
    const rows = await db.outbox(routed.ping_id);
    const escalations = rows.filter((r) => r.kind !== "desk_ping");
    assert.ok(
      escalations.length === 2 && escalations.every((r) => r.status === "pending" && r.last_error === "http_429"),
    );
  });
});
