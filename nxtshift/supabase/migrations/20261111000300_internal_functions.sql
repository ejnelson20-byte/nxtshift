-- nxtshift internal (private) functions. Not callable by client roles.
-- ---------------------------------------------------------------------------

-- Fixed-window rate limiter. Returns true when the hit is allowed.
-- NOTE: callers that need failed attempts to count (e.g. invite brute force)
-- must not raise afterwards, or the increment is rolled back with the txn.
create function private.rate_limit_hit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  v_hits integer;
begin
  insert into private.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = rl.hits + 1
  returning rl.hits into v_hits;
  return v_hits <= p_max;
end;
$$;

create function private.log_event(p_event text, p_workspace_id uuid default null, p_detail jsonb default '{}'::jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.security_events (workspace_id, actor_auth_uid, event, detail)
  values (p_workspace_id, auth.uid(), p_event, coalesce(p_detail, '{}'::jsonb));
$$;

-- Cryptographically random invite code (gen_random_uuid uses a CSPRNG).
-- Bytes 0..5 of a v4 UUID are fully random; 256 % 32 = 0 so no modulo bias.
create function private.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_code text := '';
begin
  for i in 0..5 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- Convert a wall-clock date/time in a workspace time zone to timestamptz.
-- Rejects local times that do not exist (DST spring-forward gap).
-- For ambiguous fall-back times PostgreSQL picks the earlier (DST) instant;
-- private.local_time_is_ambiguous lets callers surface a warning.
create function private.local_to_timestamptz(p_date date, p_time time, p_tz text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ts timestamptz := (p_date + p_time) at time zone p_tz;
begin
  if (v_ts at time zone p_tz) <> (p_date + p_time) then
    raise exception 'nonexistent_local_time' using detail = p_date::text || ' ' || p_time::text;
  end if;
  return v_ts;
end;
$$;

create function private.local_time_is_ambiguous(p_date date, p_time time, p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- If shifting the instant by one hour lands on the same wall-clock time, the
  -- local time occurs twice.
  select ((((p_date + p_time) at time zone p_tz) + interval '1 hour') at time zone p_tz) = (p_date + p_time)
      or ((((p_date + p_time) at time zone p_tz) - interval '1 hour') at time zone p_tz) = (p_date + p_time);
$$;

-- Resolve a local shift window; end <= start means the shift crosses midnight.
create function private.resolve_shift_window(
  p_date date, p_start time, p_end time, p_tz text,
  out start_time timestamptz, out end_time timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
begin
  start_time := private.local_to_timestamptz(p_date, p_start, p_tz);
  if p_end > p_start then
    end_time := private.local_to_timestamptz(p_date, p_end, p_tz);
  else
    end_time := private.local_to_timestamptz(p_date + 1, p_end, p_tz);
  end if;
end;
$$;

-- Which shift currently owns a desk?
-- Candidates: shifts whose window contains p_at, plus checked-in shifts that
-- began early (Assume Duty opens 15 minutes before start).
-- Priority: checked in > later start (the incoming shift) > id (determinism).
create function private.active_shift_for_desk(p_workspace_id uuid, p_desk_label text, p_at timestamptz default now())
returns public.shifts
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.shifts s
  where s.workspace_id = p_workspace_id
    and (p_desk_label is null or s.desk_label = p_desk_label)
    and s.end_time > p_at
    and (s.start_time <= p_at or (s.is_checked_in and s.start_time <= p_at + interval '15 minutes'))
  order by s.is_checked_in desc, s.start_time desc, s.id
  limit 1;
$$;

create function private.active_desk_labels(p_workspace_id uuid, p_at timestamptz default now())
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct s.desk_label
  from public.shifts s
  where s.workspace_id = p_workspace_id
    and s.end_time > p_at
    and (s.start_time <= p_at or (s.is_checked_in and s.start_time <= p_at + interval '15 minutes'))
  order by 1;
$$;

-- Enqueue one push for a member. Members without a token are recorded as
-- 'no_device' so delivery state stays auditable. Returns true when a
-- deliverable (token-holding) row was queued.
create function private.enqueue_push(
  p_workspace_id uuid,
  p_ping_id uuid,
  p_recipient_member_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_data jsonb,
  p_dedupe_key text,
  p_category_id text default null,
  p_channel_id text default 'default'
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_has_token boolean;
begin
  select m.expo_push_token is not null into v_has_token
  from public.members m
  where m.id = p_recipient_member_id and m.workspace_id = p_workspace_id;

  if not found then
    return false;
  end if;

  insert into private.push_outbox (
    workspace_id, ping_id, recipient_member_id, kind, title, body, data,
    category_id, channel_id, status, dedupe_key
  ) values (
    p_workspace_id, p_ping_id, p_recipient_member_id, p_kind, p_title, p_body,
    coalesce(p_data, '{}'::jsonb), p_category_id, p_channel_id,
    case when v_has_token then 'pending'::private.push_status else 'no_device'::private.push_status end,
    p_dedupe_key
  )
  on conflict (dedupe_key) do nothing;

  return v_has_token;
end;
$$;

create function private.preset_label(p_preset text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_preset
    when 'front_door' then 'Front Door / Relief Needed'
    when 'urgent_issue' then 'Urgent Issue'
    when 'supervisor_check' then 'Supervisor Check'
    when 'general_request' then 'General Desk Request'
  end;
$$;

-- Escalate a desk ping to the backup and every lead/admin in the workspace.
-- Caller must hold a row lock on the ping. Idempotent: no-op if already
-- escalated or acknowledged. Returns number of deliverable recipients queued.
create function private.escalate_ping(p_ping_id uuid, p_reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ping public.pings;
  v_shift public.shifts;
  v_label text;
  v_queued integer := 0;
  v_recipient record;
begin
  select * into v_ping from public.pings where id = p_ping_id;
  if not found or v_ping.category = 'top_alert'
     or v_ping.escalated_at is not null or v_ping.acknowledged_at is not null then
    return 0;
  end if;

  select * into v_shift from public.shifts where id = v_ping.target_shift_id;
  v_label := coalesce(private.preset_label(v_ping.preset), 'Desk request');

  update public.pings set escalated_at = now() where id = p_ping_id;

  for v_recipient in
    select m.id, 'backup_escalation'::text as kind
    from public.members m
    where m.id = v_shift.backup_member_id
      and m.workspace_id = v_ping.workspace_id
      and m.id is distinct from v_ping.sender_member_id
      and m.id is distinct from v_shift.assigned_member_id
    union
    select m.id, 'lead_escalation'::text
    from public.members m
    where m.workspace_id = v_ping.workspace_id
      and m.role in ('lead', 'admin')
      and m.id is distinct from v_ping.sender_member_id
      and m.id is distinct from v_shift.assigned_member_id
      and m.id is distinct from v_shift.backup_member_id
  loop
    if private.enqueue_push(
      v_ping.workspace_id, v_ping.id, v_recipient.id, v_recipient.kind,
      'ESCALATED: ' || v_label,
      'Unacknowledged at ' || coalesce(v_shift.desk_label, 'the desk') || '. Tap to acknowledge.',
      jsonb_build_object('type', v_recipient.kind, 'ping_id', v_ping.id),
      'ping:' || v_ping.id || ':esc:' || v_recipient.id,
      'NXTSHIFT_PING',
      'urgent'
    ) then
      v_queued := v_queued + 1;
    end if;
  end loop;

  perform private.log_event(
    case when v_queued = 0 then 'escalation_unreachable' else 'ping_escalated' end,
    v_ping.workspace_id,
    jsonb_build_object('ping_id', v_ping.id, 'reason', p_reason, 'recipients', v_queued)
  );
  return v_queued;
end;
$$;

-- Lock all private helpers away from client roles. Only
-- the RLS helpers granted in the access-control migration remain callable.
revoke all on function private.rate_limit_hit(text, integer, integer) from public;
revoke all on function private.log_event(text, uuid, jsonb) from public;
revoke all on function private.generate_invite_code() from public;
revoke all on function private.local_to_timestamptz(date, time, text) from public;
revoke all on function private.local_time_is_ambiguous(date, time, text) from public;
revoke all on function private.resolve_shift_window(date, time, time, text) from public;
revoke all on function private.active_shift_for_desk(uuid, text, timestamptz) from public;
revoke all on function private.active_desk_labels(uuid, timestamptz) from public;
revoke all on function private.enqueue_push(uuid, uuid, uuid, text, text, text, jsonb, text, text, text) from public;
revoke all on function private.preset_label(text) from public;
revoke all on function private.escalate_ping(uuid, text) from public;
