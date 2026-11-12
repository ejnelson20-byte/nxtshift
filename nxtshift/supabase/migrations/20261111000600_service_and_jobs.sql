-- nxtshift service-role RPCs and scheduled jobs.
-- ---------------------------------------------------------------------------
-- Everything here is executable only by service_role (Edge Functions /
-- operator scripts) or by the database owner (pg_cron).

-- ---------------------------------------------------------------------------
-- Workspace provisioning (trusted server-side workflow)
-- ---------------------------------------------------------------------------
create function public.svc_provision_workspace(p_name text, p_timezone text default 'UTC')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
begin
  if not private.is_valid_timezone(p_timezone) then
    raise exception 'invalid_timezone';
  end if;
  loop
    v_code := private.generate_invite_code();
    begin
      insert into public.workspaces (name, timezone, invite_code)
      values (btrim(p_name), p_timezone, v_code)
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- collision: retry with a fresh code
    end;
  end loop;
  perform private.log_event('workspace_provisioned', v_id, '{}'::jsonb);
  return jsonb_build_object('workspace_id', v_id, 'invite_code', v_code);
end;
$$;

-- Promote/demote by callsign (used to bootstrap the first admin after they
-- join from their own device and read their callsign to the operator).
create function public.svc_set_member_role(p_workspace_id uuid, p_callsign text, p_role public.member_role)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  update public.members set role = p_role
  where workspace_id = p_workspace_id and lower(callsign) = lower(btrim(p_callsign))
  returning * into v_member;
  if not found then
    raise exception 'member_not_found';
  end if;
  perform private.log_event('role_changed', p_workspace_id, jsonb_build_object('member_id', v_member.id, 'role', p_role, 'by', 'service'));
  return jsonb_build_object('member_id', v_member.id, 'role', v_member.role);
end;
$$;

create function public.svc_rate_limit_hit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select private.rate_limit_hit(p_bucket, p_max, p_window_seconds);
$$;

create function public.svc_log_event(p_event text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.log_event(p_event, null, p_detail);
$$;

-- Context for parse-shift-schedule: callsigns + timezone for the caller's
-- workspace. Takes the verified auth uid; enforces lead role.
create function public.svc_lead_import_context(p_auth_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select * into v_me from public.members m where m.auth_uid = p_auth_uid;
  if not found or v_me.role not in ('lead', 'admin') then
    return null;
  end if;
  return jsonb_build_object(
    'member_id', v_me.id,
    'workspace_id', v_me.workspace_id,
    'timezone', (select w.timezone from public.workspaces w where w.id = v_me.workspace_id),
    'callsigns', coalesce((
      select jsonb_agg(m.callsign order by lower(m.callsign))
      from public.members m where m.workspace_id = v_me.workspace_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Three-minute escalation sweep. Safe under concurrent/retried schedulers:
-- FOR UPDATE SKIP LOCKED + re-checked predicates on the locked row version.
-- ---------------------------------------------------------------------------
create function public.run_escalations(p_limit integer default 100)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select p.id from public.pings p
    where p.category = 'urgent_desk'
      and p.acknowledged_at is null
      and p.escalated_at is null
      and p.created_at <= now() - interval '3 minutes'
      and p.created_at > now() - interval '24 hours'
    order by p.created_at
    limit p_limit
    for update skip locked
  loop
    perform private.escalate_ping(v_id, 'ack_timeout');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Push outbox: claim → send (Edge Function) → record tickets → receipts.
-- ---------------------------------------------------------------------------
create function public.svc_claim_push_batch(p_limit integer default 100)
returns table (
  id uuid, kind text, ping_id uuid, token text, title text, body text, data jsonb,
  category_id text, channel_id text, priority text, attempts integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Nothing left to say for acknowledged pings.
  update private.push_outbox o set status = 'cancelled', updated_at = now()
  from public.pings p
  where o.ping_id = p.id and o.status = 'pending' and p.acknowledged_at is not null;

  -- Recipients that lost their token since enqueue.
  update private.push_outbox o set status = 'no_device', updated_at = now()
  from public.members m
  where o.recipient_member_id = m.id and o.status = 'pending' and m.expo_push_token is null;

  return query
  with due as (
    select o.id
    from private.push_outbox o
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_until < now()) -- crashed dispatcher lease
    order by o.created_at
    limit least(greatest(p_limit, 1), 500)
    for update skip locked
  ),
  claimed as (
    update private.push_outbox o
    set status = 'sending',
        attempts = o.attempts + 1,
        locked_until = now() + interval '2 minutes',
        token_sha256 = sha256(convert_to(m.expo_push_token, 'UTF8')),
        updated_at = now()
    from due, public.members m
    where o.id = due.id and m.id = o.recipient_member_id and m.expo_push_token is not null
    returning o.id, o.kind, o.ping_id, m.expo_push_token, o.title, o.body, o.data,
              o.category_id, o.channel_id, o.priority, o.attempts
  )
  select * from claimed;
end;
$$;

-- p_results: [{id, outcome: accepted|retry|device_not_registered|failed, ticket_id?, error?}]
create function public.svc_record_push_results(p_results jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_row private.push_outbox;
  v_count integer := 0;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    select * into v_row from private.push_outbox o
    where o.id = (v_item ->> 'id')::uuid and o.status = 'sending'
    for update;
    continue when not found;

    case v_item ->> 'outcome'
      when 'accepted' then
        update private.push_outbox set status = 'accepted', expo_ticket_id = left(v_item ->> 'ticket_id', 100),
          locked_until = null, last_error = null, updated_at = now()
        where id = v_row.id;
      when 'device_not_registered' then
        update private.push_outbox set status = 'failed', locked_until = null,
          last_error = 'DeviceNotRegistered', updated_at = now()
        where id = v_row.id;
        update public.members set expo_push_token = null, push_token_updated_at = now()
        where id = v_row.recipient_member_id
          and sha256(convert_to(expo_push_token, 'UTF8')) = v_row.token_sha256;
      when 'retry' then
        update private.push_outbox set
          status = case when v_row.attempts >= 5 then 'failed'::private.push_status else 'pending'::private.push_status end,
          -- Exponential backoff: 15s, 30s, 60s, 120s ... capped at 5 minutes.
          next_attempt_at = now() + least(interval '5 minutes', interval '15 seconds' * power(2, greatest(v_row.attempts - 1, 0))),
          locked_until = null,
          last_error = left(coalesce(v_item ->> 'error', 'retryable_error'), 120),
          updated_at = now()
        where id = v_row.id;
      else
        update private.push_outbox set status = 'failed', locked_until = null,
          last_error = left(coalesce(v_item ->> 'error', 'failed'), 120), updated_at = now()
        where id = v_row.id;
    end case;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function public.svc_claim_receipt_batch(p_limit integer default 300)
returns table (id uuid, ticket_id text)
language sql
volatile
security definer
set search_path = ''
as $$
  with due as (
    select o.id from private.push_outbox o
    where o.status = 'accepted' and o.expo_ticket_id is not null
      and o.updated_at <= now() - interval '30 seconds'
      and (o.receipt_checked_at is null or o.receipt_checked_at <= now() - interval '2 minutes')
    order by o.updated_at
    limit least(greatest(p_limit, 1), 1000)
    for update skip locked
  )
  update private.push_outbox o set receipt_checked_at = now()
  from due where o.id = due.id
  returning o.id, o.expo_ticket_id;
$$;

-- p_results: [{id, outcome: ok|pending|device_not_registered|retry|error, error?}]
create function public.svc_record_receipts(p_results jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_row private.push_outbox;
  v_count integer := 0;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    select * into v_row from private.push_outbox o
    where o.id = (v_item ->> 'id')::uuid and o.status = 'accepted'
    for update;
    continue when not found;

    case v_item ->> 'outcome'
      when 'ok' then
        update private.push_outbox set status = 'provider_ok', updated_at = now() where id = v_row.id;
      when 'pending' then
        null; -- receipt not available yet; re-checked later
      when 'device_not_registered' then
        update private.push_outbox set status = 'failed', last_error = 'DeviceNotRegistered', updated_at = now()
        where id = v_row.id;
        update public.members set expo_push_token = null, push_token_updated_at = now()
        where id = v_row.recipient_member_id
          and sha256(convert_to(expo_push_token, 'UTF8')) = v_row.token_sha256;
      when 'retry' then
        update private.push_outbox set
          status = case when v_row.attempts >= 5 then 'failed'::private.push_status else 'pending'::private.push_status end,
          expo_ticket_id = null,
          next_attempt_at = now() + interval '30 seconds',
          last_error = left(coalesce(v_item ->> 'error', 'receipt_retry'), 120),
          updated_at = now()
        where id = v_row.id;
      else
        update private.push_outbox set status = 'failed',
          last_error = left(coalesce(v_item ->> 'error', 'receipt_error'), 120), updated_at = now()
        where id = v_row.id;
    end case;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention. Eventual deletion: runs every 10 minutes, so rows may persist up
-- to ~24h10m (RLS hides expired pings/alerts from clients immediately).
-- ---------------------------------------------------------------------------
create function public.purge_expired_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pings integer;
  v_outbox integer;
  v_limits integer;
  v_events integer;
  v_handoffs integer;
  v_shifts integer;
begin
  -- Outbox first (rows not tied to a ping, e.g. handoffs), then pings
  -- (cascade removes any remaining dependent outbox rows).
  delete from private.push_outbox where created_at < now() - interval '24 hours';
  get diagnostics v_outbox = row_count;
  delete from public.pings where created_at < now() - interval '24 hours';
  get diagnostics v_pings = row_count;
  delete from private.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_limits = row_count;
  delete from private.security_events where created_at < now() - interval '30 days';
  get diagnostics v_events = row_count;
  delete from private.shift_handoffs where created_at < now() - interval '30 days';
  get diagnostics v_handoffs = row_count;
  -- Data minimization for schedules: drop shifts that ended over 30 days ago.
  delete from public.shifts where end_time < now() - interval '30 days';
  get diagnostics v_shifts = row_count;

  return jsonb_build_object(
    'pings', v_pings, 'push_outbox', v_outbox, 'rate_limits', v_limits,
    'security_events', v_events, 'shift_handoffs', v_handoffs, 'shifts', v_shifts
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service role only.
-- ---------------------------------------------------------------------------
revoke all on function public.svc_provision_workspace(text, text) from public, anon, authenticated;
revoke all on function public.svc_set_member_role(uuid, text, public.member_role) from public, anon, authenticated;
revoke all on function public.svc_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.svc_log_event(text, jsonb) from public, anon, authenticated;
revoke all on function public.svc_lead_import_context(uuid) from public, anon, authenticated;
revoke all on function public.run_escalations(integer) from public, anon, authenticated;
revoke all on function public.svc_claim_push_batch(integer) from public, anon, authenticated;
revoke all on function public.svc_record_push_results(jsonb) from public, anon, authenticated;
revoke all on function public.svc_claim_receipt_batch(integer) from public, anon, authenticated;
revoke all on function public.svc_record_receipts(jsonb) from public, anon, authenticated;
revoke all on function public.purge_expired_data() from public, anon, authenticated;

grant execute on function public.svc_provision_workspace(text, text) to service_role;
grant execute on function public.svc_set_member_role(uuid, text, public.member_role) to service_role;
grant execute on function public.svc_rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.svc_log_event(text, jsonb) to service_role;
grant execute on function public.svc_lead_import_context(uuid) to service_role;
grant execute on function public.run_escalations(integer) to service_role;
grant execute on function public.svc_claim_push_batch(integer) to service_role;
grant execute on function public.svc_record_push_results(jsonb) to service_role;
grant execute on function public.svc_claim_receipt_batch(integer) to service_role;
grant execute on function public.svc_record_receipts(jsonb) to service_role;
grant execute on function public.purge_expired_data() to service_role;
