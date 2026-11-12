-- nxtshift member-facing RPCs.
-- ---------------------------------------------------------------------------
-- Conventions:
--  * SECURITY DEFINER, search_path = '', identity derived from auth.uid().
--  * Client-supplied workspace IDs are never accepted as authorization.
--  * Business errors raise with a stable machine-readable message code.
--  * Paths where failed attempts must be counted (invite brute force) return
--    jsonb results instead of raising so the counter increment commits.

-- ---------------------------------------------------------------------------
-- Joining (service role only; invoked by the join-workspace Edge Function after
-- per-IP rate limiting). The auth uid comes from a verified JWT, not the body.
-- ---------------------------------------------------------------------------
create function public.svc_join_workspace(p_auth_uid uuid, p_invite_code text, p_callsign text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_invite_code, '')));
  v_callsign text := btrim(coalesce(p_callsign, ''));
  v_workspace public.workspaces;
  v_existing public.members;
  v_member public.members;
begin
  if p_auth_uid is null or not exists (select 1 from auth.users u where u.id = p_auth_uid) then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  -- Per-identity and global brute-force throttles. Counted before validation.
  if not private.rate_limit_hit('join:uid:' || p_auth_uid, 10, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    perform private.log_event('join_invalid_format', null, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'error', 'invalid_invite');
  end if;

  if v_callsign !~ '^[A-Za-z0-9_-]{3,24}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_callsign');
  end if;

  select * into v_workspace from public.workspaces w where w.invite_code = v_code;

  -- Unknown, revoked and expired invites are indistinguishable to the caller
  -- (anti-enumeration).
  if not found
     or v_workspace.invite_revoked_at is not null
     or (v_workspace.invite_expires_at is not null and v_workspace.invite_expires_at <= now()) then
    if not private.rate_limit_hit('join:global:invalid', 1000, 300) then
      return jsonb_build_object('ok', false, 'error', 'rate_limited');
    end if;
    perform private.log_event('join_invalid_invite', null, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'error', 'invalid_invite');
  end if;

  select * into v_existing from public.members m where m.auth_uid = p_auth_uid;
  if found then
    if v_existing.workspace_id = v_workspace.id and lower(v_existing.callsign) = lower(v_callsign) then
      return jsonb_build_object(
        'ok', true, 'status', 'existing', 'member_id', v_existing.id,
        'workspace_id', v_existing.workspace_id, 'role', v_existing.role
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  if not private.rate_limit_hit('join:ws:' || v_workspace.id, 60, 3600) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  begin
    insert into public.members (auth_uid, workspace_id, callsign, role)
    values (p_auth_uid, v_workspace.id, v_callsign, 'member')
    returning * into v_member;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'callsign_taken');
  end;

  perform private.log_event('member_joined', v_workspace.id, jsonb_build_object('member_id', v_member.id));
  return jsonb_build_object(
    'ok', true, 'status', 'joined', 'member_id', v_member.id,
    'workspace_id', v_member.workspace_id, 'role', v_member.role
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile / session context
-- ---------------------------------------------------------------------------
create function public.get_my_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when m.id is null then null else jsonb_build_object(
    'member_id', m.id,
    'callsign', m.callsign,
    'role', m.role,
    'has_push_token', m.expo_push_token is not null,
    'workspace', jsonb_build_object('id', w.id, 'name', w.name, 'timezone', w.timezone)
  ) end
  from (select 1) one
  left join public.members m on m.auth_uid = auth.uid()
  left join public.workspaces w on w.id = m.workspace_id;
$$;

create function public.leave_workspace()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.current_member();
begin
  if v_me.id is null then
    raise exception 'not_a_member';
  end if;

  -- Serialize role changes in this workspace so the last-admin check is sound.
  perform pg_advisory_xact_lock(hashtextextended('roles:' || v_me.workspace_id, 0));
  if v_me.role = 'admin' and not exists (
    select 1 from public.members m
    where m.workspace_id = v_me.workspace_id and m.role = 'admin' and m.id <> v_me.id
  ) then
    raise exception 'last_admin';
  end if;

  delete from public.members where id = v_me.id;
  perform private.log_event('member_left', v_me.workspace_id, jsonb_build_object('member_id', v_me.id));
  return jsonb_build_object('status', 'left');
end;
$$;

-- ---------------------------------------------------------------------------
-- Device registration
-- ---------------------------------------------------------------------------
create function public.register_push_token(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.current_member();
  v_token text := btrim(coalesce(p_token, ''));
begin
  if v_me.id is null then
    raise exception 'not_a_member';
  end if;
  if v_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,128}\]$' then
    raise exception 'invalid_push_token';
  end if;
  if v_me.expo_push_token = v_token then
    return jsonb_build_object('status', 'unchanged');
  end if;
  if not private.rate_limit_hit('push_token:' || v_me.id, 20, 3600) then
    raise exception 'rate_limited';
  end if;

  -- A reinstall/new anonymous account on the same device must not leave the
  -- token attached to an abandoned membership (it would receive that
  -- membership's pings).
  update public.members set expo_push_token = null, push_token_updated_at = now()
  where expo_push_token = v_token and id <> v_me.id;

  update public.members set expo_push_token = v_token, push_token_updated_at = now()
  where id = v_me.id;
  return jsonb_build_object('status', 'registered');
end;
$$;

create function public.clear_push_token()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.members set expo_push_token = null, push_token_updated_at = now()
  where auth_uid = auth.uid();
  return jsonb_build_object('status', 'cleared');
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk status — labels and coarse status only. Never returns member identity.
-- ---------------------------------------------------------------------------
create function public.get_desk_status()
returns table (desk_label text, status text, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ws uuid := private.current_workspace_id();
  v_label text;
  v_shift public.shifts;
begin
  if v_ws is null then
    raise exception 'not_a_member';
  end if;
  for v_label in select l from private.active_desk_labels(v_ws) as l loop
    v_shift := private.active_shift_for_desk(v_ws, v_label);
    desk_label := v_shift.desk_label;
    status := case when v_shift.is_checked_in then 'checked_in' else 'awaiting_relief' end;
    ends_at := v_shift.end_time;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ping the active desk
-- ---------------------------------------------------------------------------
create function public.request_desk_ping(
  p_preset text,
  p_client_request_id uuid,
  p_desk_label text default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.current_member();
  v_category public.ping_category;
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
  v_desk text := nullif(btrim(coalesce(p_desk_label, '')), '');
  v_desk_count integer;
  v_shift public.shifts;
  v_ping_id uuid;
  v_existing public.pings;
  v_label text;
  v_primary_reachable boolean := false;
  v_escalated integer := 0;
begin
  if v_me.id is null then
    raise exception 'not_a_member';
  end if;
  if p_client_request_id is null then
    raise exception 'missing_request_id';
  end if;

  v_category := case p_preset
    when 'front_door' then 'urgent_desk'::public.ping_category
    when 'urgent_issue' then 'urgent_desk'::public.ping_category
    when 'supervisor_check' then 'relief_check'::public.ping_category
    when 'general_request' then 'relief_check'::public.ping_category
  end;
  if v_category is null then
    raise exception 'invalid_category';
  end if;
  if v_note is not null and char_length(v_note) > 140 then
    raise exception 'note_too_long';
  end if;

  -- Idempotent replay: same sender + request id returns the original ping.
  select * into v_existing from public.pings p
  where p.sender_member_id = v_me.id and p.client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object(
      'status', 'duplicate', 'ping_id', v_existing.id,
      'escalation', case when v_existing.escalated_at is not null then 'escalated' else 'pending' end
    );
  end if;

  if not private.rate_limit_hit('ping:min:' || v_me.id, 6, 60)
     or not private.rate_limit_hit('ping:hour:' || v_me.id, 40, 3600) then
    raise exception 'rate_limited';
  end if;

  if v_desk is null then
    select count(*) into v_desk_count from private.active_desk_labels(v_me.workspace_id);
    if v_desk_count = 0 then
      raise exception 'no_active_shift';
    elsif v_desk_count > 1 then
      raise exception 'desk_selection_required';
    end if;
  end if;

  v_shift := private.active_shift_for_desk(v_me.workspace_id, v_desk);
  if v_shift.id is null then
    raise exception 'no_active_shift';
  end if;

  insert into public.pings (workspace_id, sender_member_id, target_shift_id, category, preset, message, client_request_id)
  values (v_me.workspace_id, v_me.id, v_shift.id, v_category, p_preset, v_note, p_client_request_id)
  on conflict on constraint pings_idempotency do nothing
  returning id into v_ping_id;

  if v_ping_id is null then
    -- Lost a race against a concurrent identical request.
    select id into v_ping_id from public.pings p
    where p.sender_member_id = v_me.id and p.client_request_id = p_client_request_id;
    return jsonb_build_object('status', 'duplicate', 'ping_id', v_ping_id, 'escalation', 'pending');
  end if;

  v_label := private.preset_label(p_preset);

  if v_shift.assigned_member_id is not null and v_shift.assigned_member_id <> v_me.id then
    v_primary_reachable := private.enqueue_push(
      v_me.workspace_id, v_ping_id, v_shift.assigned_member_id, 'desk_ping',
      case when v_category = 'urgent_desk' then 'URGENT: ' else '' end || v_label,
      v_shift.desk_label || ' request. Tap to acknowledge.',
      jsonb_build_object('type', 'desk_ping', 'ping_id', v_ping_id),
      'ping:' || v_ping_id || ':primary',
      'NXTSHIFT_PING',
      case when v_category = 'urgent_desk' then 'urgent' else 'default' end
    );
  end if;

  -- No reachable primary: escalate now rather than waiting three minutes.
  if not v_primary_reachable then
    v_escalated := private.escalate_ping(v_ping_id, 'primary_unreachable');
  end if;

  return jsonb_build_object(
    'status', 'routed',
    'ping_id', v_ping_id,
    'desk_label', v_shift.desk_label,
    'escalation', case
      when not v_primary_reachable then 'immediate'
      when v_category = 'urgent_desk' then 'scheduled'
      else 'none'
    end,
    'escalation_recipients_queued', v_escalated
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Acknowledge — server is the source of truth. Atomic with escalation via the
-- ping row lock.
-- ---------------------------------------------------------------------------
create function public.acknowledge_ping(p_ping_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.current_member();
  v_ping public.pings;
  v_shift public.shifts;
  v_authorized boolean;
begin
  if v_me.id is null then
    raise exception 'not_a_member';
  end if;

  select * into v_ping from public.pings p
  where p.id = p_ping_id and p.workspace_id = v_me.workspace_id
  for update;
  -- Cross-workspace and nonexistent pings are indistinguishable.
  if not found or v_ping.created_at <= now() - interval '24 hours' then
    raise exception 'ping_not_found';
  end if;
  if v_ping.category = 'top_alert' then
    raise exception 'not_acknowledgeable';
  end if;

  select * into v_shift from public.shifts s where s.id = v_ping.target_shift_id;
  v_authorized :=
    v_me.role in ('lead', 'admin')
    or v_shift.assigned_member_id = v_me.id
    or (v_ping.escalated_at is not null and v_shift.backup_member_id = v_me.id);
  if not coalesce(v_authorized, false) then
    raise exception 'not_authorized';
  end if;

  if v_ping.acknowledged_at is not null then
    return jsonb_build_object('status', 'already_acknowledged', 'acknowledged_at', v_ping.acknowledged_at);
  end if;

  update public.pings
  set acknowledged_at = now(), acknowledged_by_member_id = v_me.id
  where id = v_ping.id
  returning acknowledged_at into v_ping.acknowledged_at;

  -- Stop further escalation traffic that has not yet been sent.
  update private.push_outbox
  set status = 'cancelled', updated_at = now()
  where ping_id = v_ping.id and status = 'pending';

  return jsonb_build_object('status', 'acknowledged', 'acknowledged_at', v_ping.acknowledged_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Assume Duty (check-in + handoff)
-- ---------------------------------------------------------------------------
create function public.assume_duty(p_shift_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.current_member();
  v_shift public.shifts;
  v_outgoing public.shifts;
begin
  if v_me.id is null then
    raise exception 'not_a_member';
  end if;

  select * into v_shift from public.shifts s
  where s.id = p_shift_id and s.workspace_id = v_me.workspace_id;
  if not found then
    raise exception 'shift_not_found';
  end if;
  if v_shift.assigned_member_id is distinct from v_me.id then
    raise exception 'not_assigned';
  end if;

  -- Serialize handoffs per desk to avoid deadlocks and double handoffs.
  perform pg_advisory_xact_lock(hashtextextended('desk:' || v_shift.workspace_id || ':' || v_shift.desk_label, 0));
  select * into v_shift from public.shifts s where s.id = p_shift_id for update;

  if v_shift.is_checked_in then
    return jsonb_build_object('status', 'already_checked_in', 'shift_id', v_shift.id);
  end if;
  if now() < v_shift.start_time - interval '15 minutes' then
    raise exception 'too_early';
  end if;
  if now() >= v_shift.end_time then
    raise exception 'shift_ended';
  end if;

  select * into v_outgoing from public.shifts s
  where s.workspace_id = v_shift.workspace_id
    and s.desk_label = v_shift.desk_label
    and s.id <> v_shift.id
    and s.is_checked_in
    and s.start_time < v_shift.start_time
  order by s.start_time desc
  limit 1
  for update;

  if v_outgoing.id is not null then
    update public.shifts set is_checked_in = false, updated_at = now() where id = v_outgoing.id;
  end if;

  update public.shifts set is_checked_in = true, updated_at = now() where id = v_shift.id;

  insert into private.shift_handoffs (workspace_id, shift_id, incoming_member_id, outgoing_shift_id, outgoing_member_id)
  values (v_shift.workspace_id, v_shift.id, v_me.id, v_outgoing.id, v_outgoing.assigned_member_id)
  on conflict (shift_id) do nothing;

  if v_outgoing.assigned_member_id is not null and v_outgoing.assigned_member_id <> v_me.id then
    perform private.enqueue_push(
      v_shift.workspace_id, null, v_outgoing.assigned_member_id, 'shift_handoff',
      'Relief has arrived',
      'Your relief has assumed duty at ' || v_shift.desk_label || '.',
      jsonb_build_object('type', 'shift_handoff', 'shift_id', v_shift.id),
      'handoff:' || v_shift.id,
      null,
      'default'
    );
  end if;

  return jsonb_build_object(
    'status', 'checked_in',
    'shift_id', v_shift.id,
    'relieved_previous_shift', v_outgoing.id is not null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.svc_join_workspace(uuid, text, text) from public, anon, authenticated;
grant execute on function public.svc_join_workspace(uuid, text, text) to service_role;

revoke all on function public.get_my_context() from public, anon;
revoke all on function public.leave_workspace() from public, anon;
revoke all on function public.register_push_token(text) from public, anon;
revoke all on function public.clear_push_token() from public, anon;
revoke all on function public.get_desk_status() from public, anon;
revoke all on function public.request_desk_ping(text, uuid, text, text) from public, anon;
revoke all on function public.acknowledge_ping(uuid) from public, anon;
revoke all on function public.assume_duty(uuid) from public, anon;

grant execute on function public.get_my_context() to authenticated;
grant execute on function public.leave_workspace() to authenticated;
grant execute on function public.register_push_token(text) to authenticated;
grant execute on function public.clear_push_token() to authenticated;
grant execute on function public.get_desk_status() to authenticated;
grant execute on function public.request_desk_ping(text, uuid, text, text) to authenticated;
grant execute on function public.acknowledge_ping(uuid) to authenticated;
grant execute on function public.assume_duty(uuid) to authenticated;
