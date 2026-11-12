# nxtshift Architecture

## System overview

```text
 ┌──────────── Mobile app (Expo / React Native) ────────────┐
 │ Expo Router · TanStack Query · Zustand · NativeWind      │
 │ SecureStore session · expo-notifications (ACK action)    │
 └───────┬──────────────────────┬───────────────────────────┘
         │ PostgREST (RLS)      │ Edge Functions (JWT)
         │ SELECT + RPC         │ join / ping / alert / parse
 ┌───────▼──────────────────────▼───────────────────────────┐
 │ Supabase                                                  │
 │  Postgres: public (4 core tables, RPCs) · private (queue, │
 │  audit, limits) · RLS everywhere                          │
 │  pg_cron ──every 15 s──► run_escalations()                │
 │         └─every 15 s──► pg_net ─► dispatch-push           │
 │         └─every 10 m──► purge_expired_data()              │
 │  Realtime: pings (RLS-filtered invalidation)              │
 └───────┬───────────────────────────────┬──────────────────┘
         │ Expo Push API (send/receipts) │ Anthropic API (parse only)
         ▼                               ▼
      APNs / FCM                     Claude (structured JSON)
```

The database is the source of truth and the security boundary. Edge Functions exist only where something needs a secret (service role, cron secret, LLM key), an external call (Expo, Anthropic), or request metadata (client IP for join throttling). Everything else is a SECURITY DEFINER RPC so it runs in one transaction and is covered directly by RLS tests.

| Outline item             | Implementation                                                          | Why                                        |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| `route-desk-ping`        | Edge Function → `request_desk_ping` RPC (as the user) → inline dispatch | low-latency push needs the service role    |
| `publish-top-alert`      | Edge Function → `publish_top_alert` RPC → inline dispatch               | same                                       |
| `parse-shift-schedule`   | Edge Function (LLM key server-side)                                     | external API + secret                      |
| `manage-shifts`          | `lead_upsert_shift` / `lead_delete_shift` / `lead_import_shifts` RPCs   | transactional, no secrets, RLS-testable    |
| `register-device`        | `register_push_token` / `clear_push_token` RPCs                         | same                                       |
| (added) `join-workspace` | Edge Function → `svc_join_workspace`                                    | per-IP throttling needs request metadata   |
| (added) `dispatch-push`  | Edge Function, cron-invoked                                             | Expo send + receipts with the service role |

## Data model

```text
workspaces 1─* members 1─* shifts (assigned_member_id, backup_member_id)
     │            │          │
     └──────* pings *────────┘ (sender_member_id, target_shift_id)
```

The four core tables keep their specified columns. Additive columns:

- `workspaces`: `name`, `timezone` (IANA; used for all wall-clock conversion), `invite_expires_at`, `invite_revoked_at`
- `members`: `push_token_updated_at`, `created_at`
- `shifts`: `created_at`, `updated_at`
- `pings`: `preset`, `priority`, `acknowledged_by_member_id`, `client_request_id`

Integrity rules:

- Composite foreign keys `(member_id, workspace_id) → members(id, workspace_id)` and `(shift_id, workspace_id) → shifts(id, workspace_id)` make cross-workspace links impossible. PG15+ `ON DELETE SET NULL (col)` nulls only the member column.
- Case-insensitive unique callsigns per workspace, one membership per auth identity, globally unique push tokens.
- `end_time > start_time`, shifts ≤ 24 h, primary ≠ backup.
- Top alerts have no target shift or preset; desk pings always have both.

### Additional internal tables (`private` schema, not exposed by the API)

| Table                     | Purpose                                                                                                                                                | Retention |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `private.push_outbox`     | Durable, retryable notification queue with leases, attempts, backoff, Expo ticket IDs, receipt status, a dedupe key, and the SHA-256 of the token used | 24 h      |
| `private.shift_handoffs`  | Who relieved whom: incoming/outgoing member and shift. `is_checked_in` alone can't represent the outgoing member                                       | 30 days   |
| `private.rate_limits`     | Fixed-window counters (`bucket`, `window_start`, `hits`)                                                                                               | 1 day     |
| `private.security_events` | Minimal audit trail (joins, invalid invites, role changes, escalations, imports) without content                                                       | 30 days   |

Workspace provisioning metadata is just the `workspaces` row plus a `workspace_provisioned` security event. Idempotency keys live on `pings.client_request_id`.

## Ping routing

1. The client sends `{preset, client_request_id, desk_label?, note?}` to `route-desk-ping`. The `client_request_id` is reused across retries.
2. `request_desk_ping` (as the user) derives the member from `auth.uid()`, maps the preset to a category (`front_door`/`urgent_issue` → `urgent_desk`; `supervisor_check`/`general_request` → `relief_check`), applies rate limits, and returns the original ping for a duplicate request id.
3. **Active shift resolution** (`private.active_shift_for_desk`): candidates are shifts whose window contains now, plus checked-in shifts that started early (Assume Duty opens 15 minutes before start). Order by checked-in first, then latest start, then id. If several _desks_ are active and none was chosen, the call fails with `desk_selection_required`. If none are active, it fails with `no_active_shift` and nothing is routed.
4. An outbox row is enqueued for the primary. If the primary is missing or has no token, the ping escalates immediately instead of waiting three minutes.
5. The function dispatches inline and responds with `dispatch: "accepted_by_push_service" | "queued"`. The UI says the request was _routed_ and never claims delivery. Recipient identity is never returned.

## Escalation flow

```text
t=0     ping (urgent_desk) → outbox(primary)
t≥3:00  pg_cron run_escalations():
          SELECT … WHERE urgent AND unacked AND not escalated AND created ≤ now()-3m
          FOR UPDATE SKIP LOCKED
          → escalated_at = now()
          → outbox(backup) + outbox(each lead/admin), dedupe keys per recipient
t+≤15s  dispatch-push claims and sends them
ACK     acknowledge_ping(): SELECT … FOR UPDATE; authorized? → acknowledged_at;
        cancel every still-pending outbox row for the ping
```

- **No `setTimeout`.** The three-minute delay is a database predicate evaluated by a durable scheduler, using server timestamps only.
- **Exactly-once escalation:** the row lock plus the `escalated_at IS NULL` predicate (re-checked on the locked row version) plus outbox `dedupe_key` uniqueness.
- **Ack/escalation race:** both take the ping's row lock, so they serialize. If the ack wins, the sweep skips the row. If the escalation wins, the ack still succeeds (backup and leads are now authorized) and cancels unsent escalation pushes. The dispatcher also cancels pending rows for acknowledged pings before every claim.
- **Who may acknowledge:** the primary on the target shift; the backup only after escalation; leads and admins at any time. Others get `not_authorized`. Cross-workspace pings look like `ping_not_found`.
- **Nobody reachable** (no backup, no leads with devices): recorded as `escalation_unreachable` for follow-up.
- `relief_check` pings don't time-escalate, but they still escalate immediately when the primary is unreachable.

## Notification delivery

`dispatch-push` (every ~15 s via pg_net, plus inline calls):

1. `run_escalations()`, which is safe to run alongside the SQL cron job.
2. `svc_claim_push_batch`: cancel rows for acknowledged pings, mark token-less recipients `no_device`, then lease due rows (`pending`, or `sending` with an expired lease) with `FOR UPDATE SKIP LOCKED` and record the token hash.
3. Send to Expo in chunks of 100 (`categoryId: NXTSHIFT_PING` for ackable kinds, Android channel `urgent` or `default`, 24 h TTL).
4. Record ticket outcomes:
   - `ok` → `accepted`.
   - `DeviceNotRegistered` → `failed` and clear the token if the hash still matches.
   - HTTP 429, 5xx, network errors, `MessageRateExceeded` or `InvalidCredentials` → `pending` with exponential backoff (15 s → 5 min), and `failed` after 5 attempts.
   - Anything else → `failed`.
5. Receipts: `accepted` rows older than 30 s are checked. `ok` → `provider_ok` (handed to APNs/FCM). `DeviceNotRegistered` clears the token. Retryable errors are re-queued.

Status vocabulary deliberately has no "delivered". `provider_ok` is the strongest claim the system can make. Human confirmation comes only from `acknowledged_at`.

Client side, `NXTSHIFT_PING` registers an **ACKNOWLEDGE** action with `opensAppToForeground: true`. `useLastNotificationResponse` handles cold starts and warm taps alike, waits for session restoration, calls `acknowledge_ping`, and shows only the server's answer. iOS doesn't guarantee JavaScript execution for background actions when the app has been terminated, which is why the action foregrounds the app. Android behaves similarly with battery optimizations.

## Shift handoff state

`assume_duty(shift_id)`:

1. Takes an advisory lock for the (workspace, desk) and a row lock on the shift.
2. Verifies the caller is the primary and that now is within `[start − 15 min, end)`.
3. Returns `already_checked_in` for duplicate taps.
4. Finds the previous checked-in shift on the same desk (locked), sets its `is_checked_in = false`, and sets the new one to true.
5. Inserts `private.shift_handoffs` (unique per shift) and enqueues a `shift_handoff` push to the outgoing member.

Desk status shows **CHECKED IN** when the routing shift is checked in, **AWAITING RELIEF** when a shift is active but unchecked, and **NO ACTIVE SHIFT** otherwise.

## Schedule importing

```text
paste → parse-shift-schedule (lead check, rate limit) → Claude (strict JSON schema)
      → validateExtraction (reject unknown fields/types)
      → resolveExtraction (deterministic):
           · source_line must exist in the input
           · explicit dates must appear in the text; weekday names map into the chosen week
           · callsigns matched case-insensitively against workspace members only
           · missing/ambiguous times, missing desk, primary = backup, overlaps, double-booking → issues
      → lead_import_shifts(rows, commit=false) dry run (DST gaps, existing-shift conflicts)
      → review table (editable) → CONFIRM & IMPORT → lead_import_shifts(rows, commit=true)
```

The import RPC validates every row inside a subtransaction and rolls everything back unless all rows pass and `commit` is true. It's atomic and all-or-nothing. Wall-clock times are converted with the workspace time zone in PostgreSQL: nonexistent spring-forward times are rejected, ambiguous fall-back times produce a warning, and overnight shifts roll to the next day.

The model only extracts; it never decides dates or identities. The default model is `claude-opus-5-5` (`LLM_MODEL` overrides) with server-side refusal fallback enabled. If `LLM_API_KEY` is unset, the function returns `503 llm_not_configured`; it doesn't fake a result.

## Client architecture

- **Session:** `useAuthBootstrap` restores the SecureStore session. A Zustand store holds `booting | unconfigured | signed_out | ready`. Offline launches use a cached profile, marked as cached and re-verified on resume.
- **Data:** TanStack Query with focus-on-resume refetching and no automatic mutation retries (idempotency keys make manual retries safe). There are no optimistic updates for acknowledgments. A `Freshness` badge shows **LIVE** only when the last fetch succeeded within 90 s; otherwise it shows **CACHED · n m ago**.
- **Realtime:** one RLS-filtered channel on `pings` per workspace, used only to invalidate queries. Desk status polls every 30 s while the screen is mounted and the app is foregrounded.
- **Timers:** `useNow(interval)` aligns ticks to interval boundaries and lives in leaf components (`Countdown`, `Clock`) so only that text re-renders.
- **Reminders:** a pure planner builds deterministic identifiers (`shift:id:offset:startMs`) for the 60/30/15-minute reminders. Reconciliation diffs them against scheduled notifications, runs serialized (launch, resume and data change can't double-schedule), caps at 45 pending (iOS allows 64), and cancels everything on sign-out.

## Tradeoffs

- **SQL-centric business logic** keeps authorization next to the data and makes it testable with real RLS, at the cost of more PL/pgSQL.
- **Polling desk status** (30 s) instead of Realtime on `shifts` avoids broadcasting roster changes to members.
- **15-second scheduler granularity** puts escalation at 3:00–3:15 and needs pg_cron ≥ 1.5. A queue with per-message delays would be more precise but adds infrastructure.
- **Generic push text** protects content from lock screens and push providers, but recipients must open the app to see notes.
- **One membership per anonymous identity** keeps "current member" unambiguous. People in several workspaces need several installs or devices.
- **Leads are notified on every urgent escalation** (all leads and admins). Large workspaces may want on-call lead rotation later.
- **PGlite for tests** gives fast, hermetic Postgres tests without Docker. Supabase-only extensions (pg_cron, pg_net, Vault) are verified in the CI job on the real stack instead.
