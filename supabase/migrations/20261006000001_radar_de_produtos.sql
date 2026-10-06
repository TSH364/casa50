-- ===========================================================================
-- Radar de produtos: o preco do que a casa quer comprar, acompanhado por dia
--
-- A casa cadastra um produto ("air fryer Mondial 4L") e, se quiser, quanto
-- aceita pagar. Uma vez por dia - quando alguem abre o app, como o Meu Pluggy
-- - o app faz a mesma busca na web da pesquisa de compra da Dor.IA e guarda a
-- melhor oferta conferida. Caiu abaixo da meta, ou caiu de verdade desde a
-- ultima vez, vira aviso no Inicio.
--
-- So o nome do produto sai do app (para a busca). Nada da casa vai junto.
-- ===========================================================================

create table if not exists public.radar_products (
  id                uuid primary key default gen_random_uuid(),
  house_id          uuid not null references public.houses (id) on delete cascade,
  name              text not null check (btrim(name) <> '' and length(name) <= 120),
  -- Quanto a casa aceita pagar, em centavos. Sem meta, o aviso e so de queda.
  target_cents      bigint check (target_cents is null or target_cents > 0),
  is_active         boolean not null default true,
  -- A ultima conferencia: quando, e a melhor oferta que ela achou.
  last_checked_at   timestamptz,
  -- Quando uma conferencia comecou: duas abas (ou as duas pessoas) nao leem
  -- o mesmo produto ao mesmo tempo.
  check_started_at  timestamptz,
  last_error        text,
  best_cents        bigint,
  best_store        text,
  best_url          text,
  best_title        text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists radar_products_by_house on public.radar_products (house_id) where is_active;

drop trigger if exists radar_products_touch on public.radar_products;
create trigger radar_products_touch before update on public.radar_products
  for each row execute function app.touch_updated_at();

-- Uma linha por conferencia que achou preco: o historico do grafico.
create table if not exists public.radar_prices (
  id          uuid primary key default gen_random_uuid(),
  house_id    uuid not null references public.houses (id) on delete cascade,
  product_id  uuid not null references public.radar_products (id) on delete cascade,
  checked_at  timestamptz not null default now(),
  price_cents bigint not null check (price_cents > 0),
  store       text not null,
  url         text not null,
  title       text,
  -- O preco apareceu no trecho da pagina que a busca abriu.
  price_seen  boolean not null default false
);

create index if not exists radar_prices_by_product on public.radar_prices (product_id, checked_at desc);

alter table public.radar_products enable row level security;
alter table public.radar_prices enable row level security;

drop policy if exists radar_products_select on public.radar_products;
create policy radar_products_select on public.radar_products
  for select to authenticated using (app.is_member(house_id));
drop policy if exists radar_products_insert on public.radar_products;
create policy radar_products_insert on public.radar_products
  for insert to authenticated with check (app.can_write(house_id));
drop policy if exists radar_products_update on public.radar_products;
create policy radar_products_update on public.radar_products
  for update to authenticated using (app.can_write(house_id)) with check (app.can_write(house_id));
drop policy if exists radar_products_delete on public.radar_products;
create policy radar_products_delete on public.radar_products
  for delete to authenticated using (app.can_write(house_id));

drop policy if exists radar_prices_select on public.radar_prices;
create policy radar_prices_select on public.radar_prices
  for select to authenticated using (app.is_member(house_id));
drop policy if exists radar_prices_insert on public.radar_prices;
create policy radar_prices_insert on public.radar_prices
  for insert to authenticated with check (
    app.can_write(house_id)
    and exists (select 1 from public.radar_products p where p.id = product_id and p.house_id = radar_prices.house_id)
  );
drop policy if exists radar_prices_delete on public.radar_prices;
create policy radar_prices_delete on public.radar_prices
  for delete to authenticated using (app.can_write(house_id));

-- O gasto de IA do radar com nome proprio, para a tela da chave mostrar
-- quanto o radar custa separado da pesquisa da conversa.
alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in ('orcamento', 'jev', 'conversa_gratuita', 'conversa_paga', 'insights', 'pesquisa', 'voz', 'radar'));
