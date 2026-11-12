-- nxtshift access control: membership helpers, RLS policies, column grants.
-- ---------------------------------------------------------------------------
-- Helpers are SECURITY DEFINER so RLS policies can resolve the caller's
-- membership without recursively evaluating the members policy.
-- All functions pin search_path = '' and schema-qualify every object.

create function private.current_member()
returns public.members
language sql
stable
security definer
set search_path = ''
as $$
  select m.* from public.members m where m.auth_uid = auth.uid();
$$;

create function private.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.members m where m.auth_uid = auth.uid();
$$;

create function private.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from public.members m where m.auth_uid = auth.uid();
$$;

create function private.is_lead()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.role in ('lead', 'admin') from public.members m where m.auth_uid = auth.uid()),
    false
  );
$$;

-- Ping visibility: top alerts for the whole workspace; desk pings only for the
-- sender, the primary on the target shift, the backup once escalated, and leads.
create function private.can_view_ping(p_ping public.pings)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_ping.category = 'top_alert'
    or p_ping.sender_member_id = private.current_member_id()
    or private.is_lead()
    or exists (
      select 1
      from public.shifts s
      where s.id = p_ping.target_shift_id
        and s.workspace_id = p_ping.workspace_id
        and (
          s.assigned_member_id = private.current_member_id()
          or (p_ping.escalated_at is not null and s.backup_member_id = private.current_member_id())
        )
    );
$$;

-- Only authenticated sessions may call the RLS helpers.
revoke all on function private.current_member() from public;
revoke all on function private.current_member_id() from public;
revoke all on function private.current_workspace_id() from public;
revoke all on function private.is_lead() from public;
revoke all on function private.can_view_ping(public.pings) from public;
grant usage on schema private to authenticated;
grant execute on function private.current_member_id() to authenticated;
grant execute on function private.current_workspace_id() to authenticated;
grant execute on function private.is_lead() to authenticated;
grant execute on function private.can_view_ping(public.pings) to authenticated;
-- current_member() returns the push token column; it stays definer-internal.

-- ---------------------------------------------------------------------------
-- Policies (SELECT only). There are intentionally no INSERT/UPDATE/DELETE
-- grants or policies for client roles: every mutation goes through an
-- audited SECURITY DEFINER RPC that re-derives identity from auth.uid().
-- ---------------------------------------------------------------------------
create policy workspaces_select_own on public.workspaces
  for select to authenticated
  using (id = (select private.current_workspace_id()));

create policy members_select_self_or_lead on public.members
  for select to authenticated
  using (
    auth_uid = (select auth.uid())
    or (workspace_id = (select private.current_workspace_id()) and (select private.is_lead()))
  );

create policy shifts_select_own_or_lead on public.shifts
  for select to authenticated
  using (
    workspace_id = (select private.current_workspace_id())
    and (
      assigned_member_id = (select private.current_member_id())
      or backup_member_id = (select private.current_member_id())
      or (select private.is_lead())
    )
  );

-- Expired rows are hidden immediately even before the purge job deletes them.
create policy pings_select_visible on public.pings
  for select to authenticated
  using (
    workspace_id = (select private.current_workspace_id())
    and created_at > now() - interval '24 hours'
    and private.can_view_ping(pings)
  );

-- ---------------------------------------------------------------------------
-- Column-level grants (output minimization).
-- Invite codes are only available to leads through an RPC.
-- Push tokens and auth identifiers are never selectable by clients.
-- ---------------------------------------------------------------------------
grant select (id, name, timezone, created_at) on public.workspaces to authenticated;
grant select (id, workspace_id, callsign, role, created_at) on public.members to authenticated;
grant select (
  id, workspace_id, desk_label, assigned_member_id, backup_member_id,
  start_time, end_time, is_checked_in, created_at, updated_at
) on public.shifts to authenticated;
grant select (
  id, workspace_id, sender_member_id, target_shift_id, category, message, preset, priority,
  acknowledged_at, escalated_at, created_at
) on public.pings to authenticated;
