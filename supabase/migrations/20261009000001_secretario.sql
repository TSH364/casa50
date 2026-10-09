-- ===========================================================================
-- Secretario: o Gmail de cada pessoa lido pelo app, para separar o que pede
-- algo da casa (conta a pagar, comprovante, compromisso, pedido de acao).
--
-- ONDE O SEGREDO MORA: o refresh token do Google fica no Vault, como o Client
-- Secret do Meu Pluggy (20261004000001_meu_pluggy.sql). A tabela guarda so o
-- endereco, a ultima leitura e o ultimo erro.
--
-- O QUE FICA GUARDADO DE CADA E-MAIL: remetente, assunto, data, o tipo, um
-- resumo de uma linha e, quando houver, valor e datas. O corpo do e-mail nao
-- e guardado - e lido do Gmail, vai a IA e e descartado.
--
-- QUEM VE: a casa inteira ve os itens separados (e o secretario dos dois);
-- cada pessoa conecta e desconecta so o proprio Gmail.
-- ===========================================================================

create table if not exists public.email_connections (
  id              uuid primary key default gen_random_uuid(),
  house_id        uuid not null references public.houses (id) on delete cascade,
  member_id       uuid not null references public.profiles (id) on delete cascade,
  provider        text not null default 'gmail' check (provider = 'gmail'),
  email_address   text not null check (char_length(email_address) between 3 and 320),
  secret_id       uuid,
  last_sync_at    timestamptz,
  sync_started_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (house_id, member_id)
);

alter table public.email_connections enable row level security;

drop policy if exists email_connections_select on public.email_connections;
create policy email_connections_select on public.email_connections
  for select to authenticated using (app.is_member(house_id));

create table if not exists public.email_items (
  id            uuid primary key default gen_random_uuid(),
  house_id      uuid not null references public.houses (id) on delete cascade,
  connection_id uuid not null references public.email_connections (id) on delete cascade,
  member_id     uuid not null references public.profiles (id) on delete cascade,
  gmail_id      text not null check (gmail_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  from_name     text check (char_length(from_name) <= 200),
  from_address  text check (char_length(from_address) <= 320),
  subject       text check (char_length(subject) <= 300),
  received_at   timestamptz not null,
  kind          text not null check (kind in ('conta', 'comprovante', 'compromisso', 'acao', 'informativo')),
  summary       text check (char_length(summary) <= 300),
  amount        numeric(12, 2) check (amount is null or amount > 0),
  due_date      date,
  event_date    date,
  status        text not null default 'pendente' check (status in ('pendente', 'feito', 'ignorado')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (house_id, gmail_id)
);

create index if not exists email_items_pendentes
  on public.email_items (house_id, status, received_at desc);

alter table public.email_items enable row level security;

drop policy if exists email_items_select on public.email_items;
create policy email_items_select on public.email_items
  for select to authenticated using (app.is_member(house_id));
drop policy if exists email_items_insert on public.email_items;
create policy email_items_insert on public.email_items
  for insert to authenticated with check (
    app.can_write(house_id)
    and exists (
      select 1 from public.email_connections c
       where c.id = connection_id and c.house_id = email_items.house_id and c.member_id = email_items.member_id
    )
  );
drop policy if exists email_items_update on public.email_items;
create policy email_items_update on public.email_items
  for update to authenticated using (app.can_write(house_id)) with check (app.can_write(house_id));
drop policy if exists email_items_delete on public.email_items;
create policy email_items_delete on public.email_items
  for delete to authenticated using (app.can_write(house_id));

-- O gasto de IA do secretario com nome proprio.
alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in ('orcamento', 'jev', 'conversa_gratuita', 'conversa_paga', 'insights', 'pesquisa', 'voz', 'radar', 'secretario'));
