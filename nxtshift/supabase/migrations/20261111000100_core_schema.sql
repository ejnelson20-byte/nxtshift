-- nxtshift core schema
-- ---------------------------------------------------------------------------
-- Four core tables (workspaces, members, shifts, pings) live in `public`.
-- Internal reliability/security tables live in `private`, which is NOT exposed
-- through the Data API and has no grants for client roles.
--
-- Cross-workspace integrity is enforced with composite foreign keys:
-- every reference to a member or shift includes workspace_id, so a valid UUID
-- from another workspace can never be attached.

create schema if not exists private;
revoke all on schema private from public;

-- Supabase grants broad default privileges in `public` to anon/authenticated.
-- nxtshift is least-privilege: nothing is granted unless done explicitly below
-- or in later migrations.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('member', 'lead', 'admin');
create type public.ping_category as enum ('urgent_desk', 'relief_check', 'top_alert');

-- Validated IANA time-zone name. Declared immutable so it can back a CHECK
-- constraint; tz names are effectively static for this purpose.
create function private.is_valid_timezone(p_tz text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  -- 6 chars from a 32-symbol alphabet without ambiguous glyphs (no 0/O/1/I).
  invite_code text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  created_at timestamptz not null default now(),
  -- Additive, non-identifying operational metadata:
  name text not null check (char_length(btrim(name)) between 1 and 60),
  timezone text not null default 'UTC' check (private.is_valid_timezone(timezone)),
  invite_expires_at timestamptz,
  invite_revoked_at timestamptz
);

comment on table public.workspaces is 'Tenant boundary. Provisioned only by trusted server-side workflows.';

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid not null unique references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  callsign text not null check (callsign ~ '^[A-Za-z0-9_-]{3,24}$'),
  role public.member_role not null default 'member',
  expo_push_token text check (
    expo_push_token is null
    or expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,128}\]$'
  ),
  push_token_updated_at timestamptz,
  created_at timestamptz not null default now(),
  -- Target for composite foreign keys (same-workspace integrity).
  unique (id, workspace_id),
  -- A device token belongs to at most one membership.
  unique (expo_push_token)
);

-- Callsigns are unique per workspace, case-insensitively.
create unique index members_workspace_callsign_ci on public.members (workspace_id, lower(callsign));
create index members_workspace_role on public.members (workspace_id, role);

comment on table public.members is 'Anonymous membership. One membership per anonymous auth identity.';
comment on column public.members.expo_push_token is 'Never readable by client roles (column grants exclude it).';

-- ---------------------------------------------------------------------------
-- shifts
-- ---------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  desk_label text not null check (char_length(btrim(desk_label)) between 1 and 40),
  assigned_member_id uuid,
  backup_member_id uuid,
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_checked_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint shifts_valid_range check (end_time > start_time),
  constraint shifts_max_length check (end_time - start_time <= interval '24 hours'),
  constraint shifts_primary_not_backup check (assigned_member_id <> backup_member_id),
  constraint shifts_assigned_same_workspace foreign key (assigned_member_id, workspace_id)
    references public.members (id, workspace_id) on delete set null (assigned_member_id),
  constraint shifts_backup_same_workspace foreign key (backup_member_id, workspace_id)
    references public.members (id, workspace_id) on delete set null (backup_member_id)
);

create index shifts_workspace_window on public.shifts (workspace_id, end_time, start_time);
create index shifts_workspace_desk_window on public.shifts (workspace_id, desk_label, start_time);
create index shifts_assigned_start on public.shifts (assigned_member_id, start_time) where assigned_member_id is not null;
create index shifts_backup_start on public.shifts (backup_member_id, start_time) where backup_member_id is not null;

-- ---------------------------------------------------------------------------
-- pings (desk pings + top alerts)
-- ---------------------------------------------------------------------------
create table public.pings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sender_member_id uuid,
  target_shift_id uuid,
  category public.ping_category not null,
  message text check (message is null or char_length(message) between 1 and 280),
  acknowledged_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  -- Additive columns:
  preset text check (preset in ('front_door', 'urgent_issue', 'supervisor_check', 'general_request')),
  priority text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  acknowledged_by_member_id uuid,
  client_request_id uuid,
  unique (id, workspace_id),
  -- Replay / double-tap protection.
  constraint pings_idempotency unique (sender_member_id, client_request_id),
  constraint pings_sender_same_workspace foreign key (sender_member_id, workspace_id)
    references public.members (id, workspace_id) on delete set null (sender_member_id),
  constraint pings_target_same_workspace foreign key (target_shift_id, workspace_id)
    references public.shifts (id, workspace_id) on delete cascade,
  constraint pings_ack_same_workspace foreign key (acknowledged_by_member_id, workspace_id)
    references public.members (id, workspace_id) on delete set null (acknowledged_by_member_id),
  -- Top alerts are workspace-wide; desk pings always target a shift and preset.
  constraint pings_target_shape check ((category = 'top_alert') = (target_shift_id is null)),
  constraint pings_preset_shape check ((category = 'top_alert') = (preset is null)),
  constraint pings_top_alert_not_ackable check (category <> 'top_alert' or acknowledged_at is null)
);

create index pings_workspace_feed on public.pings (workspace_id, category, created_at desc);
create index pings_target_shift on public.pings (target_shift_id);
create index pings_created_at on public.pings (created_at);
create index pings_escalation_due on public.pings (created_at)
  where category = 'urgent_desk' and acknowledged_at is null and escalated_at is null;

comment on table public.pings is 'Ephemeral. Purged ~24h after creation (eventual deletion via pg_cron).';

-- ---------------------------------------------------------------------------
-- private.shift_handoffs — reliable record of who relieved whom.
-- ---------------------------------------------------------------------------
create table private.shift_handoffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  shift_id uuid not null unique references public.shifts (id) on delete cascade,
  incoming_member_id uuid references public.members (id) on delete set null,
  outgoing_shift_id uuid references public.shifts (id) on delete set null,
  outgoing_member_id uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index shift_handoffs_created_at on private.shift_handoffs (created_at);

-- ---------------------------------------------------------------------------
-- private.push_outbox — durable, retryable notification queue.
-- Push tokens are NOT copied here; the dispatcher reads the current token at
-- send time and records only its SHA-256 for DeviceNotRegistered cleanup.
-- Bodies are generic text; free-text ping notes are never placed in pushes.
-- ---------------------------------------------------------------------------
create type private.push_status as enum (
  'pending',      -- waiting to be sent (or retry scheduled)
  'sending',      -- claimed by a dispatcher (lease in locked_until)
  'accepted',     -- Expo returned an ok ticket (NOT proof of delivery)
  'provider_ok',  -- Expo receipt ok: handed to APNs/FCM (still not proof the user saw it)
  'failed',       -- permanent failure or retries exhausted
  'cancelled',    -- no longer needed (e.g. ping acknowledged first)
  'no_device'     -- recipient had no registered push token
);

create table private.push_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ping_id uuid references public.pings (id) on delete cascade,
  recipient_member_id uuid not null references public.members (id) on delete cascade,
  kind text not null check (kind in ('desk_ping', 'backup_escalation', 'lead_escalation', 'shift_handoff', 'top_alert')),
  title text not null check (char_length(title) <= 80),
  body text not null check (char_length(body) <= 180),
  data jsonb not null default '{}'::jsonb,
  category_id text,
  channel_id text not null default 'default',
  priority text not null default 'high' check (priority in ('default', 'normal', 'high')),
  status private.push_status not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  token_sha256 bytea,
  expo_ticket_id text,
  receipt_checked_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 120),
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_outbox_due on private.push_outbox (next_attempt_at) where status in ('pending', 'sending');
create index push_outbox_receipts on private.push_outbox (updated_at) where status = 'accepted';
create index push_outbox_ping on private.push_outbox (ping_id);
create index push_outbox_created_at on private.push_outbox (created_at);

-- ---------------------------------------------------------------------------
-- private.rate_limits — fixed-window counters.
-- ---------------------------------------------------------------------------
create table private.rate_limits (
  bucket text not null check (char_length(bucket) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
create index rate_limits_window_start on private.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- private.security_events — minimal audit trail. Never stores message text,
-- push tokens, invite codes, or raw IP addresses.
-- ---------------------------------------------------------------------------
create table private.security_events (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_auth_uid uuid,
  event text not null check (char_length(event) <= 60),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index security_events_created_at on private.security_events (created_at);

-- ---------------------------------------------------------------------------
-- Row-level security everywhere. Private tables get RLS with no policies
-- (deny-all for any role that is not the owner / BYPASSRLS).
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.shifts enable row level security;
alter table public.pings enable row level security;
alter table private.shift_handoffs enable row level security;
alter table private.push_outbox enable row level security;
alter table private.rate_limits enable row level security;
alter table private.security_events enable row level security;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on function private.is_valid_timezone(text) from public;
