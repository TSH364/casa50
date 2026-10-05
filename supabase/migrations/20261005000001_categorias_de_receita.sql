-- ===========================================================================
-- Categorias de receita, separadas das de gasto
--
-- Pedido da casa: "quando a gente lanca uma receita, as categorias deveriam
-- ser diferentes - salario, pro-labore...". Ate aqui toda categoria era de
-- gasto, e lancar a bolsa da FAPESP oferecia Mercado, Lazer, Transporte.
--
-- `kind` diz de que lado a categoria esta. Subcategoria e sempre do mesmo lado
-- da mae (o trigger garante, para nenhuma tela precisar lembrar). Gasto
-- continua sendo o padrao: nenhuma categoria existente muda.
--
-- As de receita entram como ponto de partida, como as de gasto entraram na
-- criacao da casa: renomeaveis e removiveis.
-- ===========================================================================

alter table public.categories
  add column if not exists kind text not null default 'expense'
    check (kind in ('expense', 'income'));

comment on column public.categories.kind is
  'expense = categoria de gasto; income = categoria de receita (salario, pro-labore...). Subcategoria herda da mae.';

create or replace function app.category_kind_from_parent()
returns trigger language plpgsql
set search_path = public, pg_temp as $fn$
begin
  if new.parent_id is not null then
    select kind into new.kind from public.categories where id = new.parent_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists categories_kind_from_parent on public.categories;
create trigger categories_kind_from_parent
  before insert or update of parent_id, kind on public.categories
  for each row execute function app.category_kind_from_parent();

-- ---------------------------------------------------------------------------
-- As iniciais de receita, para as casas que ja existem. Sem auditoria: e
-- semente, como as de gasto na criacao da casa.
-- ---------------------------------------------------------------------------
select set_config('app.skip_audit', 'on', true);

insert into public.categories (house_id, name, color, icon, sort_order, kind)
select h.id, s.name, s.color, s.icon, s.sort_order, 'income'
  from public.houses h
 cross join (values
   ('Salário',          '#3F7BD9', 'briefcase',     101),
   ('Pró-labore',       '#2F6FC4', 'building-2',    102),
   ('Bolsa',            '#6AA8F5', 'graduation-cap', 103),
   ('Freelas',          '#5B9BE0', 'hammer',        104),
   ('Rendimentos',      '#4C8DF0', 'trending-up',   105),
   ('Outras receitas',  '#7FA7D9', 'circle-dashed', 199)
 ) as s(name, color, icon, sort_order)
 where not exists (
   select 1 from public.categories c
    where c.house_id = h.id and c.parent_id is null and lower(c.name) = lower(s.name)
 );

select set_config('app.skip_audit', 'off', true);

-- ---------------------------------------------------------------------------
-- Casa nova ja nasce com as duas listas.
-- ---------------------------------------------------------------------------
create or replace function app.bootstrap_house()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
begin
  perform set_config('app.skip_audit', 'on', true);

  insert into public.house_members (house_id, user_id, role, status, joined_at)
  values (new.id, new.owner_id, 'owner', 'active', now());

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

  insert into public.categories (house_id, name, color, icon, sort_order, kind)
  values
    (new.id, 'Salário',         '#3F7BD9', 'briefcase',      101, 'income'),
    (new.id, 'Pró-labore',      '#2F6FC4', 'building-2',     102, 'income'),
    (new.id, 'Bolsa',           '#6AA8F5', 'graduation-cap', 103, 'income'),
    (new.id, 'Freelas',         '#5B9BE0', 'hammer',         104, 'income'),
    (new.id, 'Rendimentos',     '#4C8DF0', 'trending-up',    105, 'income'),
    (new.id, 'Outras receitas', '#7FA7D9', 'circle-dashed',  199, 'income');

  perform set_config('app.skip_audit', 'off', true);
  return new;
end;
$fn$;
