-- nxtshift lead/admin RPCs.
-- ---------------------------------------------------------------------------

create function private.require_lead()
returns public.members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.current_member();
begin
  if v_me.id is null then
    raise exception 'not_a_member';
  end if;
  if v_me.role not in ('lead', 'admin') then
    raise exception 'not_authorized';
  end if;
  return v_me;
end;
$$;

create function private.require_admin()
returns public.members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.current_member();
begin
  if v_me.id is null then
    raise exception 'not_a_member';
  end if;
  if v_me.role <> 'admin' then
    raise exception 'not_authorized';
  end if;
  return v_me;
end;
$$;

-- Validate and write a shift. Caller must hold the workspace shift lock.
-- Conflict rules:
--  * shifts on the same desk may not overlap;
--  * a primary may not be primary or backup on another overlapping shift;
--  * a backup may not be primary on another overlapping shift.
create function private.write_shift(
  p_workspace_id uuid,
  p_shift_id uuid,
  p_desk_label text,
  p_start timestamptz,
  p_end timestamptz,
  p_assigned uuid,
  p_backup uuid
)
returns public.shifts
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_desk text := btrim(coalesce(p_desk_label, ''));
  v_existing public.shifts;
  v_row public.shifts;
begin
  if char_length(v_desk) not between 1 and 40 then
    raise exception 'invalid_desk_label';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;
  if p_end - p_start > interval '24 hours' then
    raise exception 'shift_too_long';
  end if;
  if p_end <= now() then
    raise exception 'shift_in_past';
  end if;
  if p_assigned is not null and not exists (
    select 1 from public.members m where m.id = p_assigned and m.workspace_id = p_workspace_id
  ) then
    raise exception 'primary_not_found';
  end if;
  if p_backup is not null and not exists (
    select 1 from public.members m where m.id = p_backup and m.workspace_id = p_workspace_id
  ) then
    raise exception 'backup_not_found';
  end if;
  if p_assigned is not null and p_assigned = p_backup then
    raise exception 'backup_equals_primary';
  end if;

  if exists (
    select 1 from public.shifts s
    where s.workspace_id = p_workspace_id and s.desk_label = v_desk
      and s.id is distinct from p_shift_id
      and s.start_time < p_end and s.end_time > p_start
  ) then
    raise exception 'desk_overlap';
  end if;

  if p_assigned is not null and exists (
    select 1 from public.shifts s
    where s.workspace_id = p_workspace_id and s.id is distinct from p_shift_id
      and s.start_time < p_end and s.end_time > p_start
      and (s.assigned_member_id = p_assigned or s.backup_member_id = p_assigned)
  ) then
    raise exception 'primary_conflict';
  end if;

  if p_backup is not null and exists (
    select 1 from public.shifts s
    where s.workspace_id = p_workspace_id and s.id is distinct from p_shift_id
      and s.start_time < p_end and s.end_time > p_start
      and s.assigned_member_id = p_backup
  ) then
    raise exception 'backup_conflict';
  end if;

  if p_shift_id is null then
    insert into public.shifts (workspace_id, desk_label, assigned_member_id, backup_member_id, start_time, end_time)
    values (p_workspace_id, v_desk, p_assigned, p_backup, p_start, p_end)
    returning * into v_row;
  else
    select * into v_existing from public.shifts s
    where s.id = p_shift_id and s.workspace_id = p_workspace_id
    for update;
    if not found then
      raise exception 'shift_not_found';
    end if;
    update public.shifts set
      desk_label = v_desk,
      assigned_member_id = p_assigned,
      backup_member_id = p_backup,
      start_time = p_start,
      end_time = p_end,
      -- Reassigning the primary invalidates the previous check-in.
      is_checked_in = case when v_existing.assigned_member_id is distinct from p_assigned then false else v_existing.is_checked_in end,
      updated_at = now()
    where id = p_shift_id
    returning * into v_row;
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shift CRUD
-- ---------------------------------------------------------------------------
create function public.lead_upsert_shift(
  p_shift_id uuid,
  p_desk_label text,
  p_local_date date,
  p_start_local time,
  p_end_local time,
  p_assigned_member_id uuid,
  p_backup_member_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
  v_tz text;
  v_window record;
  v_row public.shifts;
  v_warnings jsonb := '[]'::jsonb;
begin
  if p_local_date is null or p_start_local is null or p_end_local is null then
    raise exception 'invalid_time_range';
  end if;
  if not private.rate_limit_hit('shift_write:' || v_me.id, 120, 3600) then
    raise exception 'rate_limited';
  end if;

  select w.timezone into v_tz from public.workspaces w where w.id = v_me.workspace_id;
  select * into v_window from private.resolve_shift_window(p_local_date, p_start_local, p_end_local, v_tz);

  if private.local_time_is_ambiguous(p_local_date, p_start_local, v_tz) then
    v_warnings := v_warnings || '"ambiguous_start_time"'::jsonb;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('shifts:' || v_me.workspace_id, 0));
  v_row := private.write_shift(
    v_me.workspace_id, p_shift_id, p_desk_label, v_window.start_time, v_window.end_time,
    p_assigned_member_id, p_backup_member_id
  );

  return jsonb_build_object(
    'shift_id', v_row.id, 'start_time', v_row.start_time, 'end_time', v_row.end_time,
    'warnings', v_warnings
  );
end;
$$;

create function public.lead_delete_shift(p_shift_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
begin
  perform pg_advisory_xact_lock(hashtextextended('shifts:' || v_me.workspace_id, 0));
  delete from public.shifts s where s.id = p_shift_id and s.workspace_id = v_me.workspace_id;
  if not found then
    raise exception 'shift_not_found';
  end if;
  return jsonb_build_object('status', 'deleted');
end;
$$;

create function public.lead_list_shifts(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '45 days' then
    raise exception 'invalid_range';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.start_time, x.desk_label)
    from (
      select s.id, s.desk_label, s.start_time, s.end_time, s.is_checked_in,
             s.assigned_member_id, a.callsign as assigned_callsign,
             s.backup_member_id, b.callsign as backup_callsign
      from public.shifts s
      left join public.members a on a.id = s.assigned_member_id
      left join public.members b on b.id = s.backup_member_id
      where s.workspace_id = v_me.workspace_id
        and s.end_time > p_from and s.start_time < p_to
      order by s.start_time
      limit 500
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Bulk import (preview + commit). All-or-nothing.
-- Row shape: {date, start_time, end_time, primary_callsign, backup_callsign, desk_label}
-- ---------------------------------------------------------------------------
create function public.lead_import_shifts(p_rows jsonb, p_commit boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
  v_tz text;
  v_allowed_keys constant text[] := array['date', 'start_time', 'end_time', 'primary_callsign', 'backup_callsign', 'desk_label'];
  v_row jsonb;
  v_results jsonb := '[]'::jsonb;
  v_errors integer := 0;
  v_window record;
  v_primary uuid;
  v_backup uuid;
  v_shift public.shifts;
  v_date date;
  v_start time;
  v_end time;
  v_warnings jsonb;
  v_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_payload';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count = 0 or v_count > 200 then
    raise exception 'invalid_row_count';
  end if;
  if p_commit and not private.rate_limit_hit('import:' || v_me.id, 10, 3600) then
    raise exception 'rate_limited';
  end if;

  select w.timezone into v_tz from public.workspaces w where w.id = v_me.workspace_id;
  perform pg_advisory_xact_lock(hashtextextended('shifts:' || v_me.workspace_id, 0));

  begin
    for i in 0 .. v_count - 1 loop
      v_row := p_rows -> i;
      v_warnings := '[]'::jsonb;
      begin
        if jsonb_typeof(v_row) <> 'object' then
          raise exception 'invalid_row';
        end if;
        if exists (select 1 from jsonb_object_keys(v_row) k where k <> all (v_allowed_keys)) then
          raise exception 'unknown_field';
        end if;
        if coalesce(v_row ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'missing_date';
        end if;
        if coalesce(v_row ->> 'start_time', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
           or coalesce(v_row ->> 'end_time', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
          raise exception 'invalid_time';
        end if;
        v_date := (v_row ->> 'date')::date;
        v_start := (v_row ->> 'start_time')::time;
        v_end := (v_row ->> 'end_time')::time;
        if v_start = v_end then
          raise exception 'invalid_time_range';
        end if;

        if nullif(btrim(coalesce(v_row ->> 'primary_callsign', '')), '') is null then
          raise exception 'missing_primary';
        end if;
        select m.id into v_primary from public.members m
        where m.workspace_id = v_me.workspace_id and lower(m.callsign) = lower(btrim(v_row ->> 'primary_callsign'));
        if v_primary is null then
          raise exception 'unknown_primary_callsign';
        end if;

        v_backup := null;
        if nullif(btrim(coalesce(v_row ->> 'backup_callsign', '')), '') is not null then
          select m.id into v_backup from public.members m
          where m.workspace_id = v_me.workspace_id and lower(m.callsign) = lower(btrim(v_row ->> 'backup_callsign'));
          if v_backup is null then
            raise exception 'unknown_backup_callsign';
          end if;
        end if;

        select * into v_window from private.resolve_shift_window(v_date, v_start, v_end, v_tz);
        if private.local_time_is_ambiguous(v_date, v_start, v_tz) then
          v_warnings := v_warnings || '"ambiguous_start_time"'::jsonb;
        end if;

        v_shift := private.write_shift(
          v_me.workspace_id, null, v_row ->> 'desk_label', v_window.start_time, v_window.end_time, v_primary, v_backup
        );

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'index', i, 'ok', true, 'start_time', v_shift.start_time, 'end_time', v_shift.end_time,
          'warnings', v_warnings
        ));
      exception
        when sqlstate 'P0001' then
          v_errors := v_errors + 1;
          v_results := v_results || jsonb_build_array(jsonb_build_object('index', i, 'ok', false, 'error', sqlerrm));
        when data_exception then
          v_errors := v_errors + 1;
          v_results := v_results || jsonb_build_array(jsonb_build_object('index', i, 'ok', false, 'error', 'invalid_value'));
      end;
    end loop;

    if v_errors > 0 or not p_commit then
      -- Roll back every row written in this block (preview or invalid batch).
      raise exception using errcode = 'RDRBK', message = 'rollback_sentinel';
    end if;
  exception when sqlstate 'RDRBK' then
    null;
  end;

  if p_commit and v_errors = 0 then
    perform private.log_event('shifts_imported', v_me.workspace_id, jsonb_build_object('count', v_count));
  end if;

  return jsonb_build_object(
    'status', case when v_errors > 0 then 'invalid' when p_commit then 'imported' else 'valid' end,
    'imported_count', case when p_commit and v_errors = 0 then v_count else 0 end,
    'rows', v_results
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Console views
-- ---------------------------------------------------------------------------
create function public.lead_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
  v_awaiting integer := 0;
  v_label text;
begin
  for v_label in select l from private.active_desk_labels(v_me.workspace_id) as l loop
    if not (private.active_shift_for_desk(v_me.workspace_id, v_label)).is_checked_in then
      v_awaiting := v_awaiting + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'active_shifts', (
      select count(*) from public.shifts s
      where s.workspace_id = v_me.workspace_id and s.start_time <= now() and s.end_time > now()
    ),
    'upcoming_shifts', (
      select count(*) from public.shifts s
      where s.workspace_id = v_me.workspace_id and s.start_time > now() and s.start_time <= now() + interval '24 hours'
    ),
    'awaiting_relief', v_awaiting,
    'unacknowledged_urgent', (
      select count(*) from public.pings p
      where p.workspace_id = v_me.workspace_id and p.category = 'urgent_desk'
        and p.acknowledged_at is null and p.created_at > now() - interval '24 hours'
    )
  );
end;
$$;

create function public.lead_list_open_pings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
begin
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select p.id, p.category, p.preset, p.message, p.created_at, p.escalated_at, s.desk_label
      from public.pings p
      join public.shifts s on s.id = p.target_shift_id
      where p.workspace_id = v_me.workspace_id
        and p.category <> 'top_alert'
        and p.acknowledged_at is null
        and p.created_at > now() - interval '24 hours'
      order by p.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end;
$$;

create function public.lead_list_members()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'callsign', m.callsign, 'role', m.role,
      'has_device', m.expo_push_token is not null, 'created_at', m.created_at
    ) order by lower(m.callsign))
    from public.members m
    where m.workspace_id = v_me.workspace_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Top alerts
-- ---------------------------------------------------------------------------
create function public.publish_top_alert(p_message text, p_priority text, p_client_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), '[[:cntrl:]]', ' ', 'g'));
  v_priority text := coalesce(p_priority, 'normal');
  v_ping_id uuid;
  v_queued integer := 0;
  v_recipient uuid;
begin
  if char_length(v_message) not between 3 and 280 then
    raise exception 'invalid_message_length';
  end if;
  if v_priority not in ('normal', 'high', 'critical') then
    raise exception 'invalid_priority';
  end if;
  if p_client_request_id is null then
    raise exception 'missing_request_id';
  end if;

  select p.id into v_ping_id from public.pings p
  where p.sender_member_id = v_me.id and p.client_request_id = p_client_request_id;
  if v_ping_id is not null then
    return jsonb_build_object('status', 'duplicate', 'ping_id', v_ping_id);
  end if;

  -- Mass-notification abuse limits: per lead and per workspace.
  if not private.rate_limit_hit('alert:member:' || v_me.id, 3, 600)
     or not private.rate_limit_hit('alert:ws:' || v_me.workspace_id, 10, 3600) then
    raise exception 'rate_limited';
  end if;

  insert into public.pings (workspace_id, sender_member_id, category, message, priority, client_request_id)
  values (v_me.workspace_id, v_me.id, 'top_alert', v_message, v_priority, p_client_request_id)
  returning id into v_ping_id;

  -- Controlled fan-out: generic body (the alert text stays in-app), bounded.
  for v_recipient in
    select m.id from public.members m
    where m.workspace_id = v_me.workspace_id and m.id <> v_me.id and m.expo_push_token is not null
    order by m.created_at
    limit 1000
  loop
    if private.enqueue_push(
      v_me.workspace_id, v_ping_id, v_recipient, 'top_alert',
      case v_priority when 'critical' then 'CRITICAL TOP ALERT' when 'high' then 'Priority top alert' else 'New top alert' end,
      'A new announcement was posted. Open nxtshift to read it.',
      jsonb_build_object('type', 'top_alert', 'ping_id', v_ping_id),
      'alert:' || v_ping_id || ':' || v_recipient,
      null,
      case when v_priority = 'critical' then 'urgent' else 'default' end
    ) then
      v_queued := v_queued + 1;
    end if;
  end loop;

  perform private.log_event('top_alert_published', v_me.workspace_id, jsonb_build_object('ping_id', v_ping_id, 'recipients', v_queued));
  return jsonb_build_object('status', 'published', 'ping_id', v_ping_id, 'recipients_queued', v_queued);
end;
$$;

create function public.lead_retract_top_alert(p_ping_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
begin
  delete from public.pings p
  where p.id = p_ping_id and p.workspace_id = v_me.workspace_id and p.category = 'top_alert';
  if not found then
    raise exception 'alert_not_found';
  end if;
  return jsonb_build_object('status', 'retracted');
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite + membership administration
-- ---------------------------------------------------------------------------
create function public.lead_get_invite()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_lead();
  v_ws public.workspaces;
begin
  select * into v_ws from public.workspaces w where w.id = v_me.workspace_id;
  return jsonb_build_object(
    'invite_code', v_ws.invite_code,
    'expires_at', v_ws.invite_expires_at,
    'active', v_ws.invite_revoked_at is null and (v_ws.invite_expires_at is null or v_ws.invite_expires_at > now())
  );
end;
$$;

create function public.admin_rotate_invite(p_expires_in_hours integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_admin();
  v_code text;
begin
  if p_expires_in_hours is not null and p_expires_in_hours not between 1 and 2160 then
    raise exception 'invalid_expiry';
  end if;
  loop
    v_code := private.generate_invite_code();
    begin
      update public.workspaces set
        invite_code = v_code,
        invite_revoked_at = null,
        invite_expires_at = case when p_expires_in_hours is null then null else now() + make_interval(hours => p_expires_in_hours) end
      where id = v_me.workspace_id;
      exit;
    exception when unique_violation then
      -- Astronomically rare collision; try another code.
    end;
  end loop;
  perform private.log_event('invite_rotated', v_me.workspace_id, '{}'::jsonb);
  return public.lead_get_invite();
end;
$$;

create function public.admin_revoke_invite()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_admin();
begin
  update public.workspaces set invite_revoked_at = now() where id = v_me.workspace_id;
  perform private.log_event('invite_revoked', v_me.workspace_id, '{}'::jsonb);
  return jsonb_build_object('status', 'revoked');
end;
$$;

create function public.admin_set_member_role(p_member_id uuid, p_role public.member_role)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_admin();
  v_target public.members;
begin
  if p_member_id = v_me.id then
    raise exception 'cannot_change_own_role';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('roles:' || v_me.workspace_id, 0));
  update public.members set role = p_role
  where id = p_member_id and workspace_id = v_me.workspace_id
  returning * into v_target;
  if not found then
    raise exception 'member_not_found';
  end if;
  perform private.log_event('role_changed', v_me.workspace_id, jsonb_build_object('member_id', p_member_id, 'role', p_role));
  return jsonb_build_object('status', 'updated', 'member_id', v_target.id, 'role', v_target.role);
end;
$$;

create function public.admin_remove_member(p_member_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.members := private.require_admin();
begin
  if p_member_id = v_me.id then
    raise exception 'cannot_remove_self';
  end if;
  delete from public.members m
  where m.id = p_member_id and m.workspace_id = v_me.workspace_id and m.role <> 'admin';
  if not found then
    raise exception 'member_not_found';
  end if;
  perform private.log_event('member_removed', v_me.workspace_id, jsonb_build_object('member_id', p_member_id));
  return jsonb_build_object('status', 'removed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function private.require_lead() from public;
revoke all on function private.require_admin() from public;
revoke all on function private.write_shift(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid) from public;

revoke all on function public.lead_upsert_shift(uuid, text, date, time, time, uuid, uuid) from public, anon;
revoke all on function public.lead_delete_shift(uuid) from public, anon;
revoke all on function public.lead_list_shifts(timestamptz, timestamptz) from public, anon;
revoke all on function public.lead_import_shifts(jsonb, boolean) from public, anon;
revoke all on function public.lead_dashboard_summary() from public, anon;
revoke all on function public.lead_list_open_pings() from public, anon;
revoke all on function public.lead_list_members() from public, anon;
revoke all on function public.publish_top_alert(text, text, uuid) from public, anon;
revoke all on function public.lead_retract_top_alert(uuid) from public, anon;
revoke all on function public.lead_get_invite() from public, anon;
revoke all on function public.admin_rotate_invite(integer) from public, anon;
revoke all on function public.admin_revoke_invite() from public, anon;
revoke all on function public.admin_set_member_role(uuid, public.member_role) from public, anon;
revoke all on function public.admin_remove_member(uuid) from public, anon;

grant execute on function public.lead_upsert_shift(uuid, text, date, time, time, uuid, uuid) to authenticated;
grant execute on function public.lead_delete_shift(uuid) to authenticated;
grant execute on function public.lead_list_shifts(timestamptz, timestamptz) to authenticated;
grant execute on function public.lead_import_shifts(jsonb, boolean) to authenticated;
grant execute on function public.lead_dashboard_summary() to authenticated;
grant execute on function public.lead_list_open_pings() to authenticated;
grant execute on function public.lead_list_members() to authenticated;
grant execute on function public.publish_top_alert(text, text, uuid) to authenticated;
grant execute on function public.lead_retract_top_alert(uuid) to authenticated;
grant execute on function public.lead_get_invite() to authenticated;
grant execute on function public.admin_rotate_invite(integer) to authenticated;
grant execute on function public.admin_revoke_invite() to authenticated;
grant execute on function public.admin_set_member_role(uuid, public.member_role) to authenticated;
grant execute on function public.admin_remove_member(uuid) to authenticated;
