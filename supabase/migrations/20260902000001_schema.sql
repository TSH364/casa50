-- ===========================================================================
-- Fluxo - Financas do Casal :: 0001 estrutura
--
-- Convencoes:
--   * dinheiro sempre numeric(14,2) - nunca float, para nao perder centavos;
--   * invoice_month e um `date` fixado no dia 1 do mes de referencia da fatura,
--     o que permite ordenar e comparar meses sem parsing de string;
--   * toda tabela de dominio carrega house_id, que e a fronteira de isolamento
--     aplicada por RLS em 0002.
-- ===========================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Schema privado para funcoes de apoio. Fica fora do PostgREST de proposito:
-- nada aqui deve ser chamavel diretamente pelo cliente.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Enums
-- --------------------------------------------------------------------------
create type member_role       as enum ('owner', 'admin', 'member', 'viewer');
create type member_status     as enum ('invited', 'active', 'left');
create type transaction_type  as enum ('expense', 'income', 'payment', 'refund', 'fee', 'adjustment');
create type transaction_origin as enum ('invoice', 'manual', 'recurrence', 'imported_statement');
create type visibility_type   as enum ('individual', 'shared');
create type split_type        as enum ('none', 'equal', 'income_proportional', 'custom');
-- Ciclo previsto -> realizado descrito na secao 18 da especificacao.
create type forecast_status   as enum ('forecast', 'confirmed', 'cancelled', 'missing', 'divergent');
create type recurrence_interval as enum ('weekly', 'monthly', 'yearly');
create type invoice_status    as enum ('pending', 'imported', 'failed', 'reverted');
create type invoice_format    as enum ('csv', 'xlsx', 'pdf', 'manual');
create type goal_status       as enum ('active', 'completed', 'paused', 'cancelled');
create type audit_action      as enum ('create', 'update', 'delete', 'categorize', 'import', 'revert_import', 'reconcile');

-- --------------------------------------------------------------------------
-- Utilitarios
-- --------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Normaliza o nome do estabelecimento para agrupamento e deteccao de duplicidade.
-- "PG *99 RIDE", "DL*99 RIDE" e "99 Ride" convergem para "99 RIDE".
create or replace function app.normalize_merchant(raw text)
returns text language sql immutable
set search_path = public, extensions, pg_temp as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          upper(unaccent(coalesce(raw, ''))),
          '^\s*(PG|DL|PAG|PGTO|COMPRA|CB|EC|MP|PP|IFD|APL)\s*\*?\s*', ''   -- prefixos de adquirente
        ),
        '\s*[-]?\s*(PARCELA\s*)?\d{1,2}\s*/\s*\d{1,2}\s*$', ''            -- sufixo "3/12"
      ),
      '[^A-Z0-9]+', ' ', 'g'
    ),
  '');
$$;

create or replace function app.trim_merchant(raw text)
returns text language sql immutable
set search_path = public, extensions, pg_temp as $$
  select btrim(app.normalize_merchant(raw));
$$;

-- --------------------------------------------------------------------------
-- Perfis
--
-- Decisao: a especificacao chama a entidade de "User", mas no Supabase a
-- identidade canonica vive em auth.users (gerenciada pelo GoTrue e nao
-- alteravel por nos). Espelhamos os dados de exibicao em public.profiles,
-- que e o que a aplicacao le. Nomes de membros SEMPRE saem daqui - nunca
-- ha nome fixo em codigo.
-- --------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Cria o perfil assim que o usuario se cadastra.
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- --------------------------------------------------------------------------
-- Casas e membros
-- --------------------------------------------------------------------------
create table public.houses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  owner_id   uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger houses_touch before update on public.houses
  for each row execute function app.touch_updated_at();

create table public.house_members (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null references public.houses (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  invite_email text,
  role       member_role not null default 'member',
  status     member_status not null default 'invited',
  invited_at timestamptz not null default now(),
  joined_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Um convite pendente ainda nao tem user_id; um membro ativo obrigatoriamente tem.
  constraint house_members_identity check (user_id is not null or invite_email is not null),
  constraint house_members_active_needs_user check (status <> 'active' or user_id is not null)
);
create unique index house_members_unique_user on public.house_members (house_id, user_id) where user_id is not null;
create unique index house_members_unique_invite on public.house_members (house_id, lower(invite_email)) where user_id is null;
create index house_members_by_user on public.house_members (user_id) where status = 'active';
create trigger house_members_touch before update on public.house_members
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- Cartoes
--
-- Secao 11: "dono do cartao" e um campo proprio e nunca inferido de quem
-- importou a fatura. Quem importou fica em invoices.created_by, quem gastou
-- em transactions.member_id.
-- --------------------------------------------------------------------------
create table public.cards (
  id           uuid primary key default gen_random_uuid(),
  house_id     uuid not null references public.houses (id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  institution  text,
  last_four    text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  brand        text,
  owner_id     uuid references public.profiles (id) on delete set null,
  closing_day  smallint check (closing_day between 1 and 31),
  due_day      smallint check (due_day between 1 and 31),
  credit_limit numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index cards_by_house on public.cards (house_id) where is_active;
create trigger cards_touch before update on public.cards
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- Faturas importadas
-- --------------------------------------------------------------------------
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  house_id       uuid not null references public.houses (id) on delete cascade,
  card_id        uuid references public.cards (id) on delete set null,
  file_name      text,
  institution    text,
  invoice_month  date not null check (extract(day from invoice_month) = 1),
  closing_date   date,
  due_date       date,
  -- Total impresso pelo banco. Fica separado do total somado pelo sistema
  -- para que a divergencia da secao 6 possa ser exibida em vez de escondida.
  reported_total numeric(14,2),
  computed_total numeric(14,2) not null default 0,
  status         invoice_status not null default 'pending',
  format         invoice_format not null,
  file_hash      text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index invoices_by_house_month on public.invoices (house_id, invoice_month desc);
-- O mesmo arquivo nao deve ser importado duas vezes na mesma casa.
create unique index invoices_unique_file on public.invoices (house_id, file_hash)
  where file_hash is not null and status = 'imported';
create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- Categorias (auto-referencia: subcategoria e uma categoria com parent_id)
-- --------------------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null references public.houses (id) on delete cascade,
  name       text not null check (btrim(name) <> ''),
  color      text not null default '#8B8B94',
  icon       text,
  parent_id  uuid references public.categories (id) on delete cascade,
  is_active  boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_no_self_parent check (parent_id is null or parent_id <> id)
);
create unique index categories_unique_name on public.categories
  (house_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index categories_by_house on public.categories (house_id) where is_active;
create trigger categories_touch before update on public.categories
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- Lancamentos
-- --------------------------------------------------------------------------
create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  house_id            uuid not null references public.houses (id) on delete cascade,
  invoice_id          uuid references public.invoices (id) on delete cascade,
  card_id             uuid references public.cards (id) on delete set null,
  member_id           uuid references public.profiles (id) on delete set null,

  date                date not null,
  invoice_month       date not null check (extract(day from invoice_month) = 1),

  description         text not null,
  merchant_original   text,
  merchant_normalized text,
  merchant_alias      text,

  -- Sempre positivo. O sinal contabil e derivado de type, nunca do valor
  -- armazenado: guardar o sinal em dois lugares e a origem classica de
  -- totais que nao fecham.
  amount              numeric(14,2) not null check (amount >= 0),
  currency            char(3) not null default 'BRL',
  original_amount     numeric(14,2),
  original_currency   char(3),

  type                transaction_type not null default 'expense',
  origin              transaction_origin not null default 'manual',
  status              forecast_status not null default 'confirmed',

  category_id         uuid references public.categories (id) on delete set null,
  subcategory_id      uuid references public.categories (id) on delete set null,
  note                text,
  receipt_url         text,

  visibility          visibility_type not null default 'shared',
  split_type          split_type not null default 'none',
  split_percentage    jsonb,

  installment_current smallint check (installment_current is null or installment_current >= 1),
  installment_total   smallint check (installment_total is null or installment_total >= 1),
  installment_value   numeric(14,2),

  recurring_id        uuid,
  reconciled_with_id  uuid references public.transactions (id) on delete set null,

  is_hidden           boolean not null default false,
  is_reconciled       boolean not null default false,
  duplicate_key       text,

  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint transactions_installment_pair check (
    (installment_current is null and installment_total is null)
    or (installment_current is not null and installment_total is not null
        and installment_current <= installment_total)
  ),
  constraint transactions_split_needs_shared check (
    split_type = 'none' or visibility = 'shared'
  )
);

create index transactions_by_house_month on public.transactions (house_id, invoice_month desc, date desc);
create index transactions_by_card on public.transactions (house_id, card_id, invoice_month desc);
create index transactions_by_member on public.transactions (house_id, member_id, invoice_month desc);
create index transactions_by_category on public.transactions (house_id, category_id, invoice_month desc);
create index transactions_by_invoice on public.transactions (invoice_id);
create index transactions_by_recurrence on public.transactions (recurring_id) where recurring_id is not null;
create index transactions_by_merchant on public.transactions (house_id, merchant_normalized);
-- Indice NAO-unico de proposito: a secao 6 exige que duplicidades sejam
-- exibidas para revisao, nunca bloqueadas no banco - a mesma compra pode
-- aparecer legitimamente em faturas de meses diferentes.
create index transactions_duplicate_lookup on public.transactions (house_id, duplicate_key);

create trigger transactions_touch before update on public.transactions
  for each row execute function app.touch_updated_at();

-- Preenche merchant_normalized e duplicate_key. A chave inclui mes da fatura,
-- data, cartao e parcela justamente para nao colapsar compras repetidas
-- legitimas em meses diferentes.
create or replace function app.fill_transaction_keys()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $fn$
begin
  new.merchant_normalized := app.trim_merchant(coalesce(new.merchant_original, new.description));
  new.duplicate_key := encode(digest(
    concat_ws('|',
      new.house_id::text,
      to_char(new.invoice_month, 'YYYY-MM'),
      to_char(new.date, 'YYYY-MM-DD'),
      coalesce(new.merchant_normalized, ''),
      to_char(new.amount, 'FM9999999990.00'),
      coalesce(new.card_id::text, ''),
      coalesce(new.installment_current::text, ''),
      coalesce(new.installment_total::text, '')
    ), 'sha256'), 'hex');
  return new;
end;
$fn$;
create trigger transactions_fill_keys before insert or update on public.transactions
  for each row execute function app.fill_transaction_keys();

-- --------------------------------------------------------------------------
-- Recorrencias e assinaturas
-- --------------------------------------------------------------------------
create table public.recurrences (
  id           uuid primary key default gen_random_uuid(),
  house_id     uuid not null references public.houses (id) on delete cascade,
  description  text not null check (btrim(description) <> ''),
  merchant     text,
  amount       numeric(14,2) not null check (amount >= 0),
  category_id  uuid references public.categories (id) on delete set null,
  card_id      uuid references public.cards (id) on delete set null,
  owner_id     uuid references public.profiles (id) on delete set null,
  interval     recurrence_interval not null default 'monthly',
  next_date    date not null,
  expected_day smallint check (expected_day between 1 and 31),
  note         text,
  is_active    boolean not null default true,
  -- 'manual' quando o casal cadastrou; 'detected' quando o sistema inferiu a
  -- partir de dois ou mais lancamentos compativeis (secao 7).
  source       text not null default 'manual' check (source in ('manual', 'detected')),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index recurrences_by_house on public.recurrences (house_id) where is_active;
create trigger recurrences_touch before update on public.recurrences
  for each row execute function app.touch_updated_at();

alter table public.transactions
  add constraint transactions_recurring_fk
  foreign key (recurring_id) references public.recurrences (id) on delete set null;

-- --------------------------------------------------------------------------
-- Orcamentos
-- --------------------------------------------------------------------------
create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  house_id     uuid not null references public.houses (id) on delete cascade,
  category_id  uuid not null references public.categories (id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  limit_amount numeric(14,2) not null check (limit_amount > 0),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Uma unica barra por categoria e mes (secao 7).
create unique index budgets_unique on public.budgets (house_id, category_id, month);
create trigger budgets_touch before update on public.budgets
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- Metas
-- --------------------------------------------------------------------------
create table public.goals (
  id                   uuid primary key default gen_random_uuid(),
  house_id             uuid not null references public.houses (id) on delete cascade,
  name                 text not null check (btrim(name) <> ''),
  target_amount        numeric(14,2) not null check (target_amount > 0),
  target_date          date,
  monthly_contribution numeric(14,2) check (monthly_contribution is null or monthly_contribution >= 0),
  owner_id             uuid references public.profiles (id) on delete set null,
  note                 text,
  status               goal_status not null default 'active',
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index goals_by_house on public.goals (house_id);
create trigger goals_touch before update on public.goals
  for each row execute function app.touch_updated_at();

-- current_amount NAO e coluna: e a soma dos depositos. Guardar o saldo em
-- duplicidade abriria espaco para divergir do historico.
create table public.goal_deposits (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null references public.houses (id) on delete cascade,
  goal_id    uuid not null references public.goals (id) on delete cascade,
  amount     numeric(14,2) not null,
  date       date not null default current_date,
  member_id  uuid references public.profiles (id) on delete set null,
  note       text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index goal_deposits_by_goal on public.goal_deposits (goal_id, date desc);

create or replace view public.goals_with_progress
with (security_invoker = true) as
  select g.*,
         coalesce(sum(d.amount), 0)::numeric(14,2) as current_amount,
         case when g.target_amount > 0
              then least(1, greatest(0, coalesce(sum(d.amount), 0) / g.target_amount))
              else 0 end as progress
    from public.goals g
    left join public.goal_deposits d on d.goal_id = g.id
   group by g.id;

-- --------------------------------------------------------------------------
-- Regras aprendidas e apelidos de estabelecimento
-- --------------------------------------------------------------------------
create table public.learned_rules (
  id                 uuid primary key default gen_random_uuid(),
  house_id           uuid not null references public.houses (id) on delete cascade,
  pattern            text not null check (btrim(pattern) <> ''),
  normalized_pattern text not null,
  category_id        uuid references public.categories (id) on delete cascade,
  subcategory_id     uuid references public.categories (id) on delete cascade,
  merchant_alias     text,
  owner_id           uuid references public.profiles (id) on delete set null,
  confidence         numeric(4,3) not null default 1.000 check (confidence between 0 and 1),
  affected_count     integer not null default 0,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index learned_rules_unique on public.learned_rules (house_id, normalized_pattern);
create trigger learned_rules_touch before update on public.learned_rules
  for each row execute function app.touch_updated_at();

create or replace function app.fill_rule_pattern()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $fn$
begin
  new.normalized_pattern := app.trim_merchant(new.pattern);
  return new;
end;
$fn$;
create trigger learned_rules_fill before insert or update on public.learned_rules
  for each row execute function app.fill_rule_pattern();

-- --------------------------------------------------------------------------
-- Divisao de despesas e acerto mensal (secao 17)
-- --------------------------------------------------------------------------
create table public.expense_shares (
  id             uuid primary key default gen_random_uuid(),
  house_id       uuid not null references public.houses (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  member_id      uuid not null references public.profiles (id) on delete cascade,
  share_amount   numeric(14,2) not null,
  share_percent  numeric(6,3) check (share_percent between 0 and 100),
  is_settled     boolean not null default false,
  settled_at     timestamptz,
  created_at     timestamptz not null default now()
);
create unique index expense_shares_unique on public.expense_shares (transaction_id, member_id);
create index expense_shares_by_member on public.expense_shares (house_id, member_id) where not is_settled;

create table public.settlements (
  id          uuid primary key default gen_random_uuid(),
  house_id    uuid not null references public.houses (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  from_member uuid not null references public.profiles (id) on delete cascade,
  to_member   uuid not null references public.profiles (id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  paid_at     timestamptz,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint settlements_distinct_members check (from_member <> to_member)
);
create unique index settlements_unique on public.settlements (house_id, month, from_member, to_member);
create trigger settlements_touch before update on public.settlements
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- Auditoria
--
-- before_data/after_data guardam o JSON completo para rastreabilidade, mas a
-- interface (secao 19) le `summary`, que e texto humano.
-- --------------------------------------------------------------------------
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  house_id    uuid not null references public.houses (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  entity      text not null,
  entity_id   uuid,
  action      audit_action not null,
  summary     text,
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_by_house on public.audit_log (house_id, created_at desc);
create index audit_log_by_entity on public.audit_log (house_id, entity, entity_id);
create index audit_log_by_user on public.audit_log (house_id, user_id, created_at desc);
