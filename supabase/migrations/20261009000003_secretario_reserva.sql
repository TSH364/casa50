-- ===========================================================================
-- Secretario: reservar as conexoes vencidas para ler agora, e as permissoes.
--
-- Vencida: nunca lida, ou lida ha mais de p_hours. Reservada: ninguem comecou
-- a ler nos ultimos 10 minutos. O UPDATE com filtro e atomico - duas abas, ou
-- as duas pessoas abrindo o app juntas, nao leem o mesmo Gmail duas vezes.
-- ===========================================================================

create or replace function public.claim_email_sync(p_house uuid, p_hours integer)
returns setof uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_id uuid;
begin
  for v_id in
    update public.email_connections
       set sync_started_at = now()
     where house_id = p_house
       and app.can_write(p_house)
       and (last_sync_at is null or last_sync_at < now() - make_interval(hours => greatest(p_hours, 1)))
       and (sync_started_at is null or sync_started_at < now() - interval '10 minutes')
    returning id
  loop
    return next v_id;
  end loop;
end;
$fn$;

revoke all on function public.set_email_connection(uuid, text, text) from public, anon;
revoke all on function public.clear_email_connection(uuid) from public, anon;
revoke all on function public.email_connection_secrets(uuid) from public, anon;
revoke all on function public.mark_email_sync(uuid, text) from public, anon;
revoke all on function public.claim_email_sync(uuid, integer) from public, anon;

grant execute on function public.set_email_connection(uuid, text, text) to authenticated;
grant execute on function public.clear_email_connection(uuid) to authenticated;
grant execute on function public.email_connection_secrets(uuid) to authenticated;
grant execute on function public.mark_email_sync(uuid, text) to authenticated;
grant execute on function public.claim_email_sync(uuid, integer) to authenticated;
