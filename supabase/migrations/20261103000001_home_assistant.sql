-- ===========================================================================
-- Home Assistant: o Fluxo como sensores, as tarefas da casa e o consumo de
-- energia que o Home Assistant mede.
--
-- O Home Assistant chama o app sem sessao de ninguem, com um codigo da casa
-- (Bearer). O app guarda so o sha256 do codigo, e o Home Assistant so chega
-- aos dados por estas funcoes, que acham a casa pelo hash. Nenhuma devolve
-- lancamento, loja ou e-mail: o resumo e montado pelo app (com sessao) e
-- gravado pronto, ja agregado.
--
-- plpgsql, e nao sql: o corpo de uma funcao sql e conferido na criacao.
-- ===========================================================================

create table if not exists public.ha_integracoes (
  house_id          uuid primary key references public.houses (id) on delete cascade,
  token_hash        text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  tarifa_kwh        numeric(8, 4) check (tarifa_kwh is null or (tarifa_kwh > 0 and tarifa_kwh < 100)),
  resumo            jsonb,
  resumo_em         timestamptz,
  ultimo_acesso_em  timestamptz,
  criado_por        uuid references public.profiles (id) on delete set null,
  criado_em         timestamptz not null default now()
);
alter table public.ha_integracoes enable row level security;
drop policy if exists ha_integracoes_select on public.ha_integracoes;
create policy ha_integracoes_select on public.ha_integracoes
  for select to authenticated using (app.is_member(house_id));
-- O hash fica fora do alcance do navegador; so as funcoes o leem.
revoke select on public.ha_integracoes from anon, authenticated;
grant select (house_id, tarifa_kwh, resumo_em, ultimo_acesso_em, criado_em)
  on public.ha_integracoes to authenticated;

-- O consumo do mes ate o dia (kWh), como o "utility meter" mensal do Home
-- Assistant conta: uma linha por dia, a ultima do mes e o total dele.
create table if not exists public.energia_leituras (
  house_id     uuid not null references public.houses (id) on delete cascade,
  dia          date not null,
  kwh_mes      numeric(10, 3) not null check (kwh_mes >= 0 and kwh_mes < 100000),
  recebido_em  timestamptz not null default now(),
  primary key (house_id, dia)
);
alter table public.energia_leituras enable row level security;
drop policy if exists energia_leituras_select on public.energia_leituras;
create policy energia_leituras_select on public.energia_leituras
  for select to authenticated using (app.is_member(house_id));

-- --------------------------------------------------------------------------
-- Pela tela da Casa (com sessao)
-- --------------------------------------------------------------------------

-- Ligar, ou trocar o codigo: o antigo para de valer na hora.
create or replace function public.ha_ativar(p_house uuid, p_hash text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
begin
  if auth.uid() is null or app.can_write(p_house) is not true then
    raise exception 'Só quem participa da casa liga o Home Assistant.' using errcode = '42501';
  end if;
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Código inválido.' using errcode = '22023';
  end if;
  insert into public.ha_integracoes (house_id, token_hash, criado_por, criado_em)
  values (p_house, p_hash, auth.uid(), now())
  on conflict (house_id) do update
    set token_hash = excluded.token_hash,
        criado_por = excluded.criado_por,
        criado_em = now(),
        ultimo_acesso_em = null;
end;
$fn$;

create or replace function public.ha_desligar(p_house uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
begin
  if app.can_write(p_house) is not true then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  delete from public.ha_integracoes where house_id = p_house;
end;
$fn$;

create or replace function public.ha_definir_tarifa(p_house uuid, p_tarifa numeric)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
begin
  if app.can_write(p_house) is not true then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if p_tarifa is not null and (p_tarifa <= 0 or p_tarifa >= 100) then
    raise exception 'Tarifa fora do intervalo.' using errcode = '22023';
  end if;
  update public.ha_integracoes set tarifa_kwh = p_tarifa where house_id = p_house;
end;
$fn$;

-- O resumo que o Home Assistant le, montado pelo app com a sessao de quem
-- abriu a tela (ver `syncHomeAssistant`).
create or replace function public.ha_gravar_resumo(p_house uuid, p_resumo jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
begin
  if app.is_member(p_house) is not true then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if p_resumo is null or jsonb_typeof(p_resumo) <> 'object' or length(p_resumo::text) > 60000 then
    raise exception 'Resumo inválido.' using errcode = '22023';
  end if;
  update public.ha_integracoes set resumo = p_resumo, resumo_em = now() where house_id = p_house;
end;
$fn$;

-- --------------------------------------------------------------------------
-- Pelo Home Assistant (sem sessao, com o codigo)
-- --------------------------------------------------------------------------

-- A casa do codigo. Codigo errado: erro, sem dizer mais nada.
create or replace function public.ha_casa_do_codigo(p_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_house uuid;
begin
  select house_id into v_house from public.ha_integracoes
   where token_hash = lower(coalesce(p_hash, ''));
  if v_house is null then
    raise exception 'Código inválido.' using errcode = '28000';
  end if;
  update public.ha_integracoes set ultimo_acesso_em = now() where house_id = v_house;
  return v_house;
end;
$fn$;
revoke execute on function public.ha_casa_do_codigo(text) from public, anon, authenticated;

create or replace function public.ha_ler_resumo(p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_house uuid := public.ha_casa_do_codigo(p_hash);
begin
  return (
    select jsonb_build_object(
      'resumo', i.resumo,
      'resumo_em', i.resumo_em,
      'tarifa_kwh', i.tarifa_kwh,
      'energia', coalesce((
        select jsonb_agg(jsonb_build_object('dia', e.dia, 'kwh_mes', e.kwh_mes) order by e.dia)
          from public.energia_leituras e
         where e.house_id = v_house and e.dia >= (current_date - 70)
      ), '[]'::jsonb)
    )
    from public.ha_integracoes i where i.house_id = v_house
  );
end;
$fn$;

-- As tarefas abertas, na ordem do quadro.
create or replace function public.ha_tarefas(p_hash text)
returns table (id uuid, titulo text, coluna text, prazo date)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_house uuid := public.ha_casa_do_codigo(p_hash);
begin
  return query
    select t.id, t.title, l.name, t.due_date
      from public.tasks t
      join public.task_lists l on l.id = t.list_id and l.house_id = t.house_id
     where t.house_id = v_house and not t.done
     order by l.position, t.position
     limit 100;
end;
$fn$;

-- Nova tarefa, no fim da primeira coluna (como o "Criar tarefa" do e-mail).
create or replace function public.ha_tarefa_criar(p_hash text, p_titulo text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_house  uuid := public.ha_casa_do_codigo(p_hash);
  v_titulo text := btrim(regexp_replace(coalesce(p_titulo, ''), '\s+', ' ', 'g'));
  v_lista  uuid;
  v_pos    integer;
  v_id     uuid;
begin
  if v_titulo = '' or char_length(v_titulo) > 200 then
    raise exception 'Título inválido.' using errcode = '22023';
  end if;
  select l.id into v_lista from public.task_lists l
   where l.house_id = v_house order by l.position limit 1;
  if v_lista is null then
    raise exception 'A casa ainda não tem o quadro de tarefas.' using errcode = '22023';
  end if;
  select coalesce(max(t.position), -1) + 1 into v_pos
    from public.tasks t where t.house_id = v_house and t.list_id = v_lista;
  insert into public.tasks (house_id, list_id, title, position)
  values (v_house, v_lista, v_titulo, v_pos)
  returning tasks.id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.ha_tarefa_concluir(p_hash text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_house uuid := public.ha_casa_do_codigo(p_hash);
begin
  update public.tasks set done = true
   where id = p_id and house_id = v_house and not done;
  return found;
end;
$fn$;

-- O consumo do mes ate o dia. Repetir o dia troca o valor (o Home Assistant
-- manda de hora em hora).
create or replace function public.ha_registrar_energia(p_hash text, p_dia date, p_kwh numeric)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_house uuid := public.ha_casa_do_codigo(p_hash);
begin
  if p_dia is null or p_dia > current_date + 1 or p_dia < current_date - 400 then
    raise exception 'Dia fora do intervalo.' using errcode = '22023';
  end if;
  if p_kwh is null or p_kwh < 0 or p_kwh >= 100000 then
    raise exception 'Consumo fora do intervalo.' using errcode = '22023';
  end if;
  insert into public.energia_leituras (house_id, dia, kwh_mes, recebido_em)
  values (v_house, p_dia, round(p_kwh, 3), now())
  on conflict (house_id, dia) do update
    set kwh_mes = excluded.kwh_mes, recebido_em = now();
end;
$fn$;

grant execute on function public.ha_ler_resumo(text) to anon, authenticated;
grant execute on function public.ha_tarefas(text) to anon, authenticated;
grant execute on function public.ha_tarefa_criar(text, text) to anon, authenticated;
grant execute on function public.ha_tarefa_concluir(text, uuid) to anon, authenticated;
grant execute on function public.ha_registrar_energia(text, date, numeric) to anon, authenticated;
