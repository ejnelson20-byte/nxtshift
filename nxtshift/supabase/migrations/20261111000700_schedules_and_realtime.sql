-- nxtshift schedules (pg_cron), dispatcher trigger (pg_net + Vault), Realtime.
-- ---------------------------------------------------------------------------
-- Guarded so the migration set also applies to plain PostgreSQL (CI harness),
-- where these Supabase extensions are unavailable.
--
-- Required Vault secrets (set once per project, see README):
--   nxtshift_functions_url  e.g. https://<ref>.supabase.co/functions/v1
--   nxtshift_cron_secret    same value as the ESCALATION_CRON_SECRET function secret

-- Calls the dispatch-push Edge Function. No-op until secrets are configured.
create function private.invoke_dispatcher()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'nxtshift_functions_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'nxtshift_cron_secret'$q$ into v_secret;
  if v_url is null or v_secret is null then
    raise notice 'nxtshift: dispatcher secrets not configured';
    return;
  end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb, timeout_milliseconds := 10000)$q$
  using v_url || '/dispatch-push',
        jsonb_build_object('Content-Type', 'application/json', 'x-nxtshift-cron-secret', v_secret);
end;
$$;
revoke all on function private.invoke_dispatcher() from public;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    -- Durable escalation sweep directly in SQL (keeps escalation state correct
    -- even if the Edge Function is unavailable). Sub-minute schedules require
    -- pg_cron >= 1.5.
    perform cron.schedule('nxtshift-escalations', '15 seconds', $job$select public.run_escalations()$job$);

    -- Outbox dispatch + receipts (dispatch-push also runs escalations first).
    perform cron.schedule('nxtshift-dispatch', '15 seconds', $job$select private.invoke_dispatcher()$job$);

    -- Retention purge.
    perform cron.schedule('nxtshift-purge', '*/10 * * * *', $job$select public.purge_expired_data()$job$);
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Realtime postgres_changes respect RLS for subscribers.
    alter publication supabase_realtime add table public.pings;
  end if;
end;
$do$;
