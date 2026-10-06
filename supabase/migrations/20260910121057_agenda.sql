-- ===========================================================================
-- Agenda: eventos do calendario da casa (secao 11, camada de previsao)
--
-- Duas tabelas, com papeis distintos:
--
--   calendar_sources - de onde os eventos vem. Hoje so `ics`: o "endereco
--     secreto no formato iCal" que o Google Agenda publica em
--     Configuracoes > Integrar agenda. E uma URL somente-leitura, sem OAuth,
--     sem projeto no Google Cloud e sem token para renovar. O campo `kind`
--     existe para o dia em que OAuth fizer falta.
--
--   calendar_events - as OCORRENCIAS ja expandidas. Uma reuniao semanal e um
--     registro so no arquivo e uma linha por semana aqui, porque a pergunta
--     que o app faz e "que dias do mes tem compromisso".
--
-- A URL e um SEGREDO: quem a tem le a agenda inteira. Por isso ela e a unica
-- coluna do projeto fora do SELECT de `authenticated` - um `viewer` da casa
-- ve que existe uma agenda conectada e de qual servidor, mas nao recebe a
-- chave. Quem precisa dela e a sincronizacao, que a busca por um RPC
-- controlado, exigindo permissao de escrita na casa.
--
-- Eventos nao entram no audit_log de proposito: sao dado espelhado de fora,
-- reescrito a cada sincronizacao, e registrar isso afogaria o historico das
-- decisoes que o casal de fato tomou.
-- ===========================================================================

create table if not exists public.calendar_sources (
  id             uuid primary key default gen_random_uuid(),
  house_id       uuid not null references public.houses (id) on delete cascade,
  name           text not null check (btrim(name) <> ''),
  kind           text not null default 'ics' check (kind in ('ics')),
  url            text not null check (url ~ '^https://'),
  -- Servidor de origem, para a tela identificar a agenda sem exibir a chave.
  host           text generated always as (substring(url from '^https://([^/]+)')) stored,
  -- De quem e a agenda. A casa tem duas pessoas e duas agendas.
  owner_id       uuid references public.profiles (id) on delete set null,
  is_active      boolean not null default true,
  last_synced_at timestamptz,
  last_error     text,
  event_count    integer not null default 0,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- A mesma agenda cadastrada duas vezes duplicaria todo evento dela.
create unique index if not exists calendar_sources_unique
  on public.calendar_sources (house_id, url);

drop trigger if exists calendar_sources_touch on public.calendar_sources;
create trigger calendar_sources_touch before update on public.calendar_sources
  for each row execute function app.touch_updated_at();

create table if not exists public.calendar_events (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null references public.houses (id) on delete cascade,
  source_id  uuid not null references public.calendar_sources (id) on delete cascade,
  -- UID do evento no arquivo. Repete entre as ocorrencias de uma serie.
  uid        text not null,
  title      text not null,
  location   text,
  starts_on  date not null,
  -- Ultimo dia, INCLUSIVO - diferente do DTEND do iCalendar, que e exclusivo.
  -- A conversao acontece no leitor; aqui o dado ja esta na forma que a
  -- contagem de dias espera.
  ends_on    date not null check (ends_on >= starts_on),
  all_day    boolean not null default true,
  kind       text not null default 'other'
             check (kind in ('trip', 'health', 'celebration', 'education', 'home', 'work', 'other')),
  created_at timestamptz not null default now()
);

-- Uma ocorrencia por serie e por dia de inicio.
create unique index if not exists calendar_events_unique
  on public.calendar_events (source_id, uid, starts_on);

-- A consulta e sempre "eventos que encostam neste intervalo".
create index if not exists calendar_events_range
  on public.calendar_events (house_id, starts_on, ends_on);

-- --------------------------------------------------------------------------
-- RLS: a mesma regra das demais tabelas de dominio.
--   ler    -> ser membro ativo da casa
--   gravar -> ter permissao de escrita (viewer nao grava)
-- --------------------------------------------------------------------------
alter table public.calendar_sources enable row level security;
alter table public.calendar_events  enable row level security;

do $do$
declare
  t text;
begin
  foreach t in array array['calendar_sources', 'calendar_events'] loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = t
                      and policyname = t || '_select') then
      execute format(
        'create policy %1$s_select on public.%1$I for select to authenticated
           using (app.is_member(house_id));', t);
      execute format(
        'create policy %1$s_insert on public.%1$I for insert to authenticated
           with check (app.can_write(house_id));', t);
      execute format(
        'create policy %1$s_update on public.%1$I for update to authenticated
           using (app.can_write(house_id)) with check (app.can_write(house_id));', t);
      execute format(
        'create policy %1$s_delete on public.%1$I for delete to authenticated
           using (app.can_write(house_id));', t);
    end if;
  end loop;
end;
$do$;

-- --------------------------------------------------------------------------
-- A URL fica fora do SELECT.
--
-- Postgres nao deixa revogar um privilegio de coluna quando o SELECT foi
-- concedido na tabela inteira - por isso o revoke total antes, e a lista
-- explicita depois. INSERT e UPDATE continuam alcancando `url`: quem cadastra
-- precisa escrever a chave, so nao precisa le-la de volta.
-- --------------------------------------------------------------------------
revoke select on public.calendar_sources from authenticated;
grant select (
  id, house_id, name, kind, host, owner_id, is_active,
  last_synced_at, last_error, event_count, created_by, created_at, updated_at
) on public.calendar_sources to authenticated;

-- --------------------------------------------------------------------------
-- A chave, para quem sincroniza.
--
-- SECURITY DEFINER porque a coluna nao e legivel por `authenticated`; a
-- checagem de permissao e feita aqui dentro, e `viewer` fica de fora.
-- --------------------------------------------------------------------------
create or replace function public.calendar_source_url(p_source_id uuid)
returns text language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_house uuid;
  v_url   text;
begin
  select house_id, url into v_house, v_url
    from public.calendar_sources
   where id = p_source_id;

  if v_house is null then
    raise exception 'Agenda nao encontrada' using errcode = 'P0002';
  end if;
  if not app.can_write(v_house) then
    raise exception 'Sem permissao para sincronizar esta agenda' using errcode = '42501';
  end if;

  return v_url;
end;
$fn$;

revoke all on function public.calendar_source_url(uuid) from public, anon;
grant execute on function public.calendar_source_url(uuid) to authenticated;

comment on table public.calendar_sources is
  'Agendas conectadas a casa. A coluna `url` e segredo: nao e legivel por authenticated, so pelo RPC calendar_source_url.';
comment on table public.calendar_events is
  'Ocorrencias ja expandidas das agendas conectadas. Espelho de dado externo, reescrito a cada sincronizacao.';
