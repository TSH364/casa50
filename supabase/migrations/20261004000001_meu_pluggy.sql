-- ===========================================================================
-- Meu Pluggy: as compras do cartao chegam sozinhas, uma vez por dia
--
-- Cada pessoa da casa conecta os proprios bancos no Meu Pluggy (gratuito para
-- uso pessoal, ate 5 conexoes do mesmo CPF) e cola aqui as credenciais da
-- aplicacao demo do Dashboard da Pluggy: Client ID, Client Secret e os Item IDs
-- de cada conexao. O app le as compras pela API e lanca como PROVISORIAS -
-- quando a fatura chega, a conciliacao (`domain/provisorios.ts`) poe a linha do
-- banco no lugar, sem contar duas vezes.
--
-- ONDE O SEGREDO MORA: no Vault, como a chave da IA (ver
-- 20260925000001_chave_de_ia.sql, que explica o desenho e o limite dele). A
-- tabela guarda so o que nao e segredo: o Client ID, os Item IDs, os quatro
-- ultimos caracteres do segredo e a ultima sincronizacao.
--
-- QUEM FAZ O QUE:
--   - cada pessoa salva e apaga SO a propria conexao (sao os bancos dela);
--   - qualquer membro que escreve na casa le as credenciais para sincronizar -
--     abrir o app no celular de um sincroniza os bancos dos dois.
-- ===========================================================================

create table if not exists public.bank_connections (
  id            uuid primary key default gen_random_uuid(),
  house_id      uuid not null references public.houses (id) on delete cascade,
  member_id     uuid not null references public.profiles (id) on delete cascade,
  provider      text not null default 'meu_pluggy' check (provider = 'meu_pluggy'),
  client_id     text not null check (client_id ~ '^[A-Za-z0-9-]{8,80}$'),
  secret_id     uuid,
  secret_hint   text,
  item_ids      text[] not null default '{}'
    check (cardinality(item_ids) <= 10),
  last_sync_at  timestamptz,
  -- Quando uma leitura comecou: impede duas abas (ou as duas pessoas) de
  -- lerem o mesmo banco ao mesmo tempo. Ver `claim_bank_sync`.
  sync_started_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (house_id, member_id)
);

alter table public.bank_connections enable row level security;

-- Leitura: membro. Nada aqui e segredo - o segredo esta no Vault.
drop policy if exists bank_connections_select on public.bank_connections;
create policy bank_connections_select on public.bank_connections
  for select to authenticated using (app.is_member(house_id));

-- Sem politica de escrita: so pelas funcoes abaixo, que mexem no Vault junto.

-- ---------------------------------------------------------------------------
-- Salvar a propria conexao. Segredo vazio = manter o que ja esta salvo (para
-- trocar so os Item IDs sem colar o segredo de novo).
-- ---------------------------------------------------------------------------
create or replace function public.set_bank_connection(
  p_house uuid,
  p_client_id text,
  p_client_secret text,
  p_item_ids text[]
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_me      uuid := auth.uid();
  v_secret  uuid;
  v_client  text := btrim(p_client_id);
  v_key     text := btrim(coalesce(p_client_secret, ''));
  v_items   text[];
  v_hint    text;
begin
  if v_me is null or app.can_write(p_house) is not true then
    raise exception 'Só quem participa da casa conecta bancos.' using errcode = '42501';
  end if;

  if v_client !~ '^[A-Za-z0-9-]{8,80}$' then
    raise exception 'Isto não parece um Client ID da Pluggy.' using errcode = '22023';
  end if;

  select array_agg(distinct btrim(i)) into v_items
    from unnest(coalesce(p_item_ids, '{}')) as i
   where btrim(i) <> '';
  v_items := coalesce(v_items, '{}');
  if cardinality(v_items) = 0 then
    raise exception 'Informe ao menos um Item ID.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_items) i where i !~ '^[A-Za-z0-9-]{8,80}$') then
    raise exception 'Algum Item ID não está no formato da Pluggy.' using errcode = '22023';
  end if;

  select secret_id, secret_hint into v_secret, v_hint
    from public.bank_connections where house_id = p_house and member_id = v_me;

  if v_key <> '' then
    if v_key !~ '^[A-Za-z0-9_-]{8,200}$' then
      raise exception 'Isto não parece um Client Secret da Pluggy.' using errcode = '22023';
    end if;
    v_hint := '…' || right(v_key, 4);
    if v_secret is null then
      v_secret := vault.create_secret(
        v_key,
        'pluggy_' || p_house::text || '_' || v_me::text,
        'Client Secret do Meu Pluggy'
      );
    else
      perform vault.update_secret(v_secret, v_key);
    end if;
  elsif v_secret is null then
    raise exception 'Cole o Client Secret.' using errcode = '22023';
  end if;

  insert into public.bank_connections
    (house_id, member_id, client_id, secret_id, secret_hint, item_ids, last_error, updated_at)
  values (p_house, v_me, v_client, v_secret, v_hint, v_items, null, now())
  on conflict (house_id, member_id) do update
    set client_id = excluded.client_id,
        secret_id = excluded.secret_id,
        secret_hint = excluded.secret_hint,
        item_ids = excluded.item_ids,
        last_error = null,
        updated_at = now();

  return v_hint;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Apagar a propria conexao (o segredo sai do Vault junto).
-- ---------------------------------------------------------------------------
create or replace function public.clear_bank_connection(p_house uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_secret uuid;
begin
  select secret_id into v_secret
    from public.bank_connections where house_id = p_house and member_id = auth.uid();
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
  delete from public.bank_connections where house_id = p_house and member_id = auth.uid();
end;
$fn$;

-- ---------------------------------------------------------------------------
-- As credenciais da casa, para o servidor do app sincronizar.
-- ---------------------------------------------------------------------------
create or replace function public.bank_connection_secrets(p_house uuid)
returns table (id uuid, member_id uuid, client_id text, client_secret text, item_ids text[], last_sync_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
begin
  if app.can_write(p_house) is not true then
    return;
  end if;
  return query
    select c.id, c.member_id, c.client_id, s.decrypted_secret::text, c.item_ids, c.last_sync_at
      from public.bank_connections c
      join vault.decrypted_secrets s on s.id = c.secret_id
     where c.house_id = p_house;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Registrar o resultado de uma sincronizacao.
-- ---------------------------------------------------------------------------
create or replace function public.mark_bank_sync(p_connection uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_house uuid;
begin
  select house_id into v_house from public.bank_connections where id = p_connection;
  if v_house is null or app.can_write(v_house) is not true then
    return;
  end if;
  update public.bank_connections
     set last_sync_at = case when p_error is null then now() else last_sync_at end,
         last_error = left(p_error, 300),
         sync_started_at = null,
         updated_at = now()
   where id = p_connection;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Reservar as conexoes vencidas para ler agora (a abertura do app chama).
-- Vencida: nunca lida, ou lida ha mais de p_hours. Reservada: ninguem comecou
-- a ler nos ultimos 10 minutos. O UPDATE com filtro e atomico - quem nao pegar
-- a linha nao recebe nada de volta, e nao le de novo.
-- ---------------------------------------------------------------------------
create or replace function public.claim_bank_sync(p_house uuid, p_hours integer)
returns setof uuid
language sql
security definer
set search_path = public, extensions, pg_temp
as $fn$
  update public.bank_connections
     set sync_started_at = now()
   where house_id = p_house
     and app.can_write(p_house)
     and (last_sync_at is null or last_sync_at < now() - make_interval(hours => greatest(p_hours, 1)))
     and (sync_started_at is null or sync_started_at < now() - interval '10 minutes')
  returning id;
$fn$;

revoke all on function public.set_bank_connection(uuid, text, text, text[]) from public, anon;
revoke all on function public.clear_bank_connection(uuid) from public, anon;
revoke all on function public.bank_connection_secrets(uuid) from public, anon;
revoke all on function public.mark_bank_sync(uuid, text) from public, anon;
revoke all on function public.claim_bank_sync(uuid, integer) from public, anon;

grant execute on function public.set_bank_connection(uuid, text, text, text[]) to authenticated;
grant execute on function public.clear_bank_connection(uuid) to authenticated;
grant execute on function public.bank_connection_secrets(uuid) to authenticated;
grant execute on function public.mark_bank_sync(uuid, text) to authenticated;
grant execute on function public.claim_bank_sync(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Identidade da compra no banco: a mesma compra lida duas vezes (a sincronizacao
-- volta alguns dias para pegar o que o banco demorou a lancar) nao entra duas.
-- ---------------------------------------------------------------------------
alter table public.transactions add column if not exists external_id text;

create unique index if not exists transactions_external_id_uq
  on public.transactions (house_id, external_id)
  where external_id is not null;

comment on column public.transactions.external_id is
  'Id da transacao na origem externa (ex.: pluggy:<id>). Evita importar a mesma compra duas vezes.';
