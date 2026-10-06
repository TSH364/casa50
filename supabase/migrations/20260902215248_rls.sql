-- ===========================================================================
-- Fluxo - Financas do Casal :: 0002 Row Level Security
--
-- Esta migration e a unica garantia real do requisito "um usuario nunca pode
-- acessar dados de outra casa" (secao 4). O filtro por house_id no frontend e
-- conveniencia de interface; a fronteira e aqui.
--
-- As funcoes de apoio sao SECURITY DEFINER porque precisam ler house_members
-- sem disparar as proprias policies de house_members - caso contrario a
-- avaliacao recursiona indefinidamente.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Funcoes de autorizacao
-- --------------------------------------------------------------------------
create or replace function app.is_member(house uuid)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select exists (
    select 1 from public.house_members m
     where m.house_id = house
       and m.user_id = auth.uid()
       and m.status = 'active'
  );
$fn$;

create or replace function app.role_in(house uuid)
returns member_role language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select m.role from public.house_members m
   where m.house_id = house
     and m.user_id = auth.uid()
     and m.status = 'active'
   limit 1;
$fn$;

-- Quem pode criar, editar e excluir dados financeiros. `viewer` fica de fora:
-- enxerga tudo da casa, nao altera nada.
create or replace function app.can_write(house uuid)
returns boolean language sql stable as $fn$
  select app.role_in(house) in ('owner', 'admin', 'member');
$fn$;

-- Quem pode mexer em membros, convites e na propria casa.
create or replace function app.can_admin(house uuid)
returns boolean language sql stable as $fn$
  select app.role_in(house) in ('owner', 'admin');
$fn$;

grant usage on schema app to authenticated;
grant execute on function app.is_member(uuid), app.role_in(uuid),
                         app.can_write(uuid), app.can_admin(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Ao criar uma casa: o criador vira owner e as categorias padrao sao semeadas.
-- SECURITY DEFINER porque roda antes de existir qualquer vinculo do usuario
-- com a casa, ou seja, antes de app.is_member() poder retornar true.
-- --------------------------------------------------------------------------
create or replace function app.bootstrap_house()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
begin
  insert into public.house_members (house_id, user_id, role, status, joined_at)
  values (new.id, new.owner_id, 'owner', 'active', now());

  -- Categorias iniciais da secao 5. Todas editaveis e removiveis pelo casal,
  -- inclusive "TSH": nenhuma e marcada como fixa no banco.
  insert into public.categories (house_id, name, color, icon, sort_order)
  values
    (new.id, 'Moradia',     '#7C86FF', 'house',        1),
    (new.id, 'Alimentacao', '#F0A44A', 'utensils',     2),
    (new.id, 'Transporte',  '#4FB6E8', 'car',          3),
    (new.id, 'Saude',       '#5FD3A6', 'heart-pulse',  4),
    (new.id, 'Educacao',    '#9B7BE8', 'graduation-cap', 5),
    (new.id, 'Lazer',       '#F07AA8', 'party-popper', 6),
    (new.id, 'Assinaturas', '#5EC8C0', 'repeat',       7),
    (new.id, 'Compras',     '#E8A0D8', 'shopping-bag', 8),
    (new.id, 'Viagens',     '#67A6F5', 'plane',        9),
    (new.id, 'Servicos',    '#8FA0B8', 'wrench',      10),
    (new.id, 'Tarifas',     '#D8925E', 'receipt',     11),
    (new.id, 'Impostos',    '#C9737A', 'landmark',    12),
    (new.id, 'TSH',         '#A5B3C4', 'briefcase',   13),
    (new.id, 'Outros',      '#8B8B94', 'circle-dashed', 99);

  return new;
end;
$fn$;

create trigger houses_bootstrap after insert on public.houses
  for each row execute function app.bootstrap_house();

-- --------------------------------------------------------------------------
-- Aceite de convite
--
-- Um convidado ainda nao e membro, entao nao passa por nenhuma policy de
-- house_members. O aceite precisa ser um RPC controlado: ele so casa o
-- convite pelo e-mail autenticado do proprio usuario.
-- --------------------------------------------------------------------------
create or replace function public.accept_house_invite(p_house_id uuid)
returns public.house_members language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_email text;
  v_row   public.house_members;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'Nao autenticado' using errcode = '28000';
  end if;

  update public.house_members
     set user_id = auth.uid(), status = 'active', joined_at = now()
   where house_id = p_house_id
     and status = 'invited'
     and lower(invite_email) = lower(v_email)
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Convite nao encontrado para este e-mail' using errcode = 'P0002';
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.accept_house_invite(uuid) from public, anon;
grant execute on function public.accept_house_invite(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Habilitar RLS em tudo
-- --------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.houses         enable row level security;
alter table public.house_members  enable row level security;
alter table public.cards          enable row level security;
alter table public.invoices       enable row level security;
alter table public.categories     enable row level security;
alter table public.transactions   enable row level security;
alter table public.recurrences    enable row level security;
alter table public.budgets        enable row level security;
alter table public.goals          enable row level security;
alter table public.goal_deposits  enable row level security;
alter table public.learned_rules  enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements    enable row level security;
alter table public.audit_log      enable row level security;

-- --------------------------------------------------------------------------
-- profiles
-- --------------------------------------------------------------------------
-- Um usuario enxerga o proprio perfil e o de quem divide casa com ele - e
-- so por isso o seletor de perfil consegue mostrar nomes reais (secao 4).
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
        from public.house_members mine
        join public.house_members theirs on theirs.house_id = mine.house_id
       where mine.user_id = (select auth.uid()) and mine.status = 'active'
         and theirs.user_id = public.profiles.id and theirs.status = 'active'
    )
  );

create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- houses
-- --------------------------------------------------------------------------
create policy houses_select on public.houses for select to authenticated
  using (owner_id = (select auth.uid()) or app.is_member(id));

create policy houses_insert on public.houses for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy houses_update on public.houses for update to authenticated
  using (app.can_admin(id)) with check (app.can_admin(id));

create policy houses_delete on public.houses for delete to authenticated
  using (owner_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- house_members
-- --------------------------------------------------------------------------
create policy house_members_select on public.house_members for select to authenticated
  using (user_id = (select auth.uid()) or app.is_member(house_id));

create policy house_members_insert on public.house_members for insert to authenticated
  with check (app.can_admin(house_id));

create policy house_members_update on public.house_members for update to authenticated
  using (app.can_admin(house_id) or user_id = (select auth.uid()))
  with check (app.can_admin(house_id) or user_id = (select auth.uid()));

-- Sair da casa e permitido a qualquer membro; remover outro exige admin.
create policy house_members_delete on public.house_members for delete to authenticated
  using (app.can_admin(house_id) or user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- Tabelas de dominio: mesma regra em todas.
--   ler   -> ser membro ativo da casa
--   gravar-> ser membro com permissao de escrita (viewer nao grava)
-- --------------------------------------------------------------------------
do $do$
declare
  t text;
begin
  foreach t in array array[
    'cards', 'invoices', 'categories', 'transactions', 'recurrences',
    'budgets', 'goals', 'goal_deposits', 'learned_rules',
    'expense_shares', 'settlements'
  ] loop
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
  end loop;
end;
$do$;

-- --------------------------------------------------------------------------
-- audit_log: append-only.
-- Sem policy de UPDATE e sem policy de DELETE - com RLS habilitada, a
-- ausencia de policy nega a operacao. Um historico que pode ser reescrito
-- nao e historico.
-- --------------------------------------------------------------------------
create policy audit_log_select on public.audit_log for select to authenticated
  using (app.is_member(house_id));

create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (app.is_member(house_id));
