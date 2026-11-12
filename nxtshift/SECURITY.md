# nxtshift Security

nxtshift is a multi-tenant system that carries operationally sensitive signals: who is on duty, urgent requests, and escalations. This document describes the threat model, the controls in place, and the limitations that remain.

**Compliance:** nxtshift has not been assessed for HIPAA, FERPA, CJIS, or classified-information handling. Do not represent it as compliant with any regime without an independent assessment and the organizational controls that regime requires.

## Threat model

| Actor                                 | Goal                                                                                  | Primary controls                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outsider without an invite            | Join a workspace, enumerate invite codes                                              | 32⁶ (~1.07 × 10⁹) invite space; per-IP (20/h), per-identity (10/15 min), per-workspace (60/h) and global invalid-invite throttles; unknown, revoked and expired codes return the same error; Supabase anonymous sign-in rate limit                                                                                                                                                        |
| Member of workspace A                 | Read or modify workspace B                                                            | Every RLS policy is scoped by `private.current_workspace_id()` derived from `auth.uid()`; composite `(id, workspace_id)` foreign keys reject cross-workspace references even with valid UUIDs; RPCs never accept a client workspace ID                                                                                                                                                    |
| Ordinary member                       | Learn who is on duty, read the roster, harvest push tokens, promote self, spam alerts | Desk status RPC returns only desk labels and coarse status; shift RLS shows only one's own assignments; `members` RLS returns only one's own row; column grants exclude `expo_push_token`, `auth_uid` and `invite_code`; clients have no INSERT, UPDATE or DELETE grants on any table; role changes are admin-only RPCs                                                                   |
| Lead                                  | Overreach into other workspaces, mass-notify                                          | Lead RPCs re-check role and workspace; per-lead (3/10 min) and per-workspace (10/h) alert limits; fan-out capped at 1,000 recipients; publisher sees only a recipient count                                                                                                                                                                                                               |
| Compromised or malicious client build | Call privileged operations directly                                                   | All authorization is server-side; hiding the Lead tab is UX only; the publishable key can only do what RLS and grants allow                                                                                                                                                                                                                                                               |
| Push provider or OS lock screen       | Read message content                                                                  | Push bodies are generic ("Urgent desk request. Tap to acknowledge."); free-text notes and alert text are never placed in push payloads; Android channels use `PRIVATE` lock-screen visibility                                                                                                                                                                                             |
| Prompt injection via pasted schedules | Make the parser create members, change roles, or invent data                          | Text is delimited and declared untrusted in the system prompt; strict JSON schema with `additionalProperties: false`; validation rejects unknown fields; every row must quote a line that exists in the input; dates must appear in the text; callsigns are matched only against existing members; nothing is written until the lead confirms, and the import RPC re-validates everything |
| Replay or double-tap                  | Duplicate pings, alerts or imports                                                    | Client-generated UUID idempotency keys with `unique (sender_member_id, client_request_id)`; imports are all-or-nothing and duplicates fail overlap checks                                                                                                                                                                                                                                 |
| Scheduler double-run or crash         | Duplicate escalation, lost pushes                                                     | `FOR UPDATE SKIP LOCKED` sweeps that re-check predicates on the locked row; `escalated_at` set once; outbox `dedupe_key` uniqueness; leased claims with expiry and retry                                                                                                                                                                                                                  |

## Authentication

- **Supabase Anonymous Auth.** No email, phone number or legal name is collected. A user is an anonymous `auth.users` row plus one `members` row.
- **Session storage.** The Supabase session is stored in the iOS Keychain or Android Keystore via `expo-secure-store` with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, split into chunks because sessions exceed SecureStore's single-entry size. It is never written to AsyncStorage.
- **Token refresh** runs only while the app is in the foreground. If refresh fails (revoked or expired refresh token), local state is cleared and the user is told the anonymous identity can't be recovered.
- **Edge Functions** verify the JWT at the gateway (`verify_jwt = true`) and again in code with `auth.getUser()`. The auth uid always comes from the verified token, never from the request body. `dispatch-push` is authenticated by a ≥ 32-character shared secret compared in constant time.
- **Environment validation** refuses to start the app if the embedded key is a `sb_secret_…` key or a JWT with `role: service_role`.

## Authorization and the RLS model

- RLS is enabled on **every** table, including `private.*`, which has no policies and therefore denies all client access.
- Supabase's default public-schema grants are revoked, both per object and via `ALTER DEFAULT PRIVILEGES`.
- Clients get **SELECT only**, with column-level grants:
  - `workspaces`: `id, name, timezone, created_at` for your own workspace.
  - `members`: your own row; leads see their workspace. Never `expo_push_token` or `auth_uid`.
  - `shifts`: shifts where you are primary or backup; leads see their workspace.
  - `pings`: top alerts in your workspace; desk pings you sent, pings to your shift, pings escalated to you as backup, and everything in your workspace for leads. Rows older than 24 hours are hidden by the policy even before they are purged.
- Every mutation is a `SECURITY DEFINER` function with `search_path = ''`, fully schema-qualified, with `EXECUTE` revoked from `PUBLIC` and `anon` and granted only to the intended role. `svc_*` functions, the escalation sweep and the purge are callable only by `service_role` or the database owner (pg_cron).
- RLS helpers (`private.current_member_id()`, `private.is_lead()`, and so on) are SECURITY DEFINER lookups by `auth.uid()`. They prevent recursive policy evaluation.
- Concurrency-sensitive writes take advisory transaction locks (per workspace for shifts, per desk for handoffs, per workspace for role changes) and row locks for acknowledgment and escalation.

These properties are covered by `supabase/tests/db/*.test.ts`: workspace isolation, roster privacy, push-token secrecy, self-promotion, cross-workspace foreign keys, cross-workspace acknowledgment, and service-function lockout.

## Push-token security

- Tokens are format-validated, unique across all memberships, and moved automatically when a device re-registers under a new anonymous account (preventing an abandoned membership from receiving pings).
- No client role can select tokens. The outbox stores only a SHA-256 of the token used, so `DeviceNotRegistered` cleanup clears the token only if it hasn't changed since.
- Tokens are cleared on leave or sign-out.
- Optional: enable Expo push "enhanced security" and set `EXPO_ACCESS_TOKEN` so a leaked token can't be used to send through your project.

## Data retention

| Data                                                        | Retention                                           | Mechanism                                           |
| ----------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Pings, top alerts, notes                                    | 24 h (hidden at 24 h; deleted within ~10 min after) | RLS predicate + `purge_expired_data()` every 10 min |
| Push outbox (incl. token hashes, generic titles)            | 24 h                                                | purge + `ON DELETE CASCADE` from pings              |
| Rate-limit counters (hashed IPs, ids)                       | 1 day                                               | purge                                               |
| Security events (no message text, tokens, codes or raw IPs) | 30 days                                             | purge                                               |
| Shift handoffs                                              | 30 days                                             | purge                                               |
| Shifts                                                      | until 30 days after they end                        | purge                                               |

Deletion is **eventual**, not exact: the scheduled purge runs every 10 minutes, so a row can exist up to roughly 24 h 10 min (longer if pg_cron is down), and database backups or point-in-time recovery retain data per your Supabase plan. Edge Function logs contain only counts and error codes, never message bodies, tokens or callsigns.

## Anonymous account limitations

- **Uninstalling (Android) or clearing app data loses the identity permanently.** On iOS, Keychain items can survive reinstall, so the session may be restored. This depends on the OS and isn't guaranteed.
- **Signing out deletes the membership.** There is no recovery flow by design (no email or phone). Rejoining needs a valid invite code. The old callsign is freed only if the membership was deleted; an admin can remove orphaned memberships.
- If a device is lost, an admin should remove the member (`admin_remove_member`) and consider rotating the invite code.

## Incident response considerations

- **Leaked invite code:** an admin rotates it (`admin_rotate_invite`), removes unknown members, and reviews `private.security_events` (`member_joined`).
- **Leaked service-role key or cron secret:** rotate it in Supabase, update `supabase secrets` and the Vault secret `nxtshift_cron_secret`, then redeploy functions.
- **Abuse by a member:** an admin removes them. Their pending pings and push rows are purged within 24 h, or delete them manually.
- **Lost lead device:** demote it or remove it, and rotate the invite.
- **Emergency off-switch:** unschedule the cron jobs (`select cron.unschedule('nxtshift-dispatch')`) and disable the functions.

## Known security limitations

- Anonymous identities give **no strong identity assurance**. Anyone who obtains an invite code can join as a member. Treat invite codes as shared secrets and distribute them in person.
- IP-based throttling is best-effort; anonymous sign-ins can come from many IPs. Enable CAPTCHA on anonymous sign-ins for public deployments.
- Callsigns, timing metadata, desk labels and free-text notes can still identify people. Users are told not to enter personal details, but the system can't prevent it.
- Pasted schedules are sent to the configured LLM provider (Anthropic by default). Review that provider's data-handling terms before enabling Smart Import.
- Local notifications and pushes are subject to OS delivery policies, Focus and Do Not Disturb, and battery optimization. nxtshift never treats provider acceptance as proof of delivery, but it can't guarantee that a human saw a notification.
- Realtime is used only on `pings` (RLS-filtered) as an invalidation signal. Desk status is refreshed by gentle polling so the roster is never broadcast.
- Database concurrency is enforced with row and advisory locks. Automated tests cover repeated and retried runs sequentially (PGlite is single-connection); true parallel contention is covered by design and should be load-tested on a staging project.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the nxtshift maintainers rather than opening a public issue. Include reproduction steps and the affected version.
