-- ===========================================================================
-- Obra: o que foi comprado, o que nao foi, e o que foi comprado pela metade
--
-- A pergunta que originou o modulo, nas palavras de quem pediu: "estou em obra
-- e recebendo varios orcamentos, pagando varias coisas, precisava ter esse
-- controle do que foi comprado, do que nao foi, do que comprei parcial".
--
-- TRES DECISOES DE MODELO, todas tomadas por quem vai usar:
--
--  1. PARCIAL E DE QUANTIDADE, nao de dinheiro. "Precisava de 60 m2 de
--     porcelanato e comprei 40" - e nao "dei sinal de metade". Isso decide o
--     schema inteiro: um lancamento de cartao sozinho nao carrega "40 de 60",
--     entao a compra precisa ser registro proprio, com quantidade.
--  2. O gasto da obra ENTRA nos totais da casa, como qualquer outro.
--  3. Varias cotacoes por item, e a casa escolhe uma.
--
-- O QUE NAO E COLUNA, de proposito: quantidade comprada, valor gasto e o
-- status ("nao comprado", "parcial", "comprado"). Os tres sao a soma das
-- compras, e guardar um resumo ao lado do historico abre espaco para os dois
-- divergirem - a mesma razao pela qual `goals` nao guarda `current_amount`.
-- Status digitado a mao mente calado; status somado nao tem como.
--
-- POR QUE "COTACAO" E NAO "ORCAMENTO": o app ja chama de Orcamento o limite
-- mensal por categoria. Na obra, "orcamento" e a proposta do fornecedor. Sao
-- coisas diferentes, e reusar a palavra faria duas telas dizerem a mesma
-- coisa sobre assuntos que nao se encontram.
-- ===========================================================================

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null references public.houses (id) on delete cascade,
  name       text not null check (btrim(name) <> ''),
  note       text,
  is_active  boolean not null default true,
  started_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_by_house on public.projects (house_id);
create trigger projects_touch before update on public.projects
  for each row execute function app.touch_updated_at();

-- A ETAPA E TEXTO, e nao tabela. "Eletrica", "Marcenaria", "Pisos" servem
-- para agrupar na tela e mudam durante a obra; uma tabela a mais obrigaria a
-- cadastrar etapa antes de cadastrar item, que e trabalho antes do valor.
create table if not exists public.project_items (
  id                uuid primary key default gen_random_uuid(),
  house_id          uuid not null references public.houses (id) on delete cascade,
  project_id        uuid not null references public.projects (id) on delete cascade,
  stage             text,
  name              text not null check (btrim(name) <> ''),
  -- Unidade livre: m2, saco, peca, verba, hora. Obra nao cabe numa lista
  -- fechada, e uma lista fechada vira campo "outro" na primeira semana.
  unit              text,
  planned_quantity  numeric(14,3) check (planned_quantity is null or planned_quantity > 0),
  note              text,
  sort_order        integer not null default 0,
  -- A saida de emergencia do calculo: "isto aqui esta resolvido", mesmo que a
  -- quantidade nao feche. Sobra de material, troca de escopo e desconto no
  -- fim da obra sao normais, e um item que nunca fecha vira ruido permanente.
  closed_at         timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists project_items_by_project on public.project_items (project_id);
create index if not exists project_items_by_house on public.project_items (house_id);
create trigger project_items_touch before update on public.project_items
  for each row execute function app.touch_updated_at();

-- As propostas recebidas para UM item. `is_chosen` e no maximo uma por item,
-- garantido pelo indice parcial abaixo: duas escolhidas dariam dois valores
-- previstos para o mesmo item, e o total da obra deixaria de ter resposta.
create table if not exists public.project_quotes (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null references public.houses (id) on delete cascade,
  item_id    uuid not null references public.project_items (id) on delete cascade,
  supplier   text not null check (btrim(supplier) <> ''),
  amount     numeric(14,2) not null check (amount >= 0),
  -- A quantidade que ESTA proposta cobre, quando difere da prevista: o
  -- fornecedor que so vende caixa fechada cota 65 m2 para um item de 60.
  quantity   numeric(14,3) check (quantity is null or quantity > 0),
  note       text,
  is_chosen  boolean not null default false,
  quoted_on  date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_quotes_by_item on public.project_quotes (item_id);
create unique index if not exists project_quotes_one_chosen
  on public.project_quotes (item_id) where is_chosen;
create trigger project_quotes_touch before update on public.project_quotes
  for each row execute function app.touch_updated_at();

-- A COMPRA, que e o registro que responde a pergunta toda.
--
-- `transaction_id` e OPCIONAL porque obra se paga muito por pix, boleto e
-- dinheiro, e exigir o lancamento de cartao deixaria de fora justamente o
-- pedreiro. Quando existe, a compra aponta para o lancamento e as duas telas
-- falam do mesmo fato.
--
-- Nao ha unique em `transaction_id`: uma compra so no Leroy pode cobrir tinta,
-- rolo e massa corrida, e cada um e um item da obra.
create table if not exists public.project_purchases (
  id             uuid primary key default gen_random_uuid(),
  house_id       uuid not null references public.houses (id) on delete cascade,
  item_id        uuid not null references public.project_items (id) on delete cascade,
  transaction_id uuid references public.transactions (id) on delete set null,
  quantity       numeric(14,3) check (quantity is null or quantity > 0),
  amount         numeric(14,2) not null check (amount >= 0),
  date           date not null default current_date,
  supplier       text,
  note           text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists project_purchases_by_item on public.project_purchases (item_id);
create index if not exists project_purchases_by_transaction
  on public.project_purchases (transaction_id) where transaction_id is not null;
create trigger project_purchases_touch before update on public.project_purchases
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: mesma regra do resto do app - ver quem e da casa, escrever quem pode.
-- ---------------------------------------------------------------------------

alter table public.projects          enable row level security;
alter table public.project_items     enable row level security;
alter table public.project_quotes    enable row level security;
alter table public.project_purchases enable row level security;

do $do$
declare
  t text;
begin
  foreach t in array array['projects', 'project_items', 'project_quotes', 'project_purchases']
  loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = t
                      and policyname = t || '_select') then
      execute format(
        'create policy %I on public.%I for select to authenticated using (app.is_member(house_id))',
        t || '_select', t);
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (app.can_write(house_id))',
        t || '_insert', t);
      execute format(
        'create policy %I on public.%I for update to authenticated using (app.can_write(house_id)) with check (app.can_write(house_id))',
        t || '_update', t);
      execute format(
        'create policy %I on public.%I for delete to authenticated using (app.can_write(house_id))',
        t || '_delete', t);
    end if;
  end loop;
end;
$do$;

comment on table public.projects is
  'Uma obra ou reforma. O gasto dela entra nos totais da casa como qualquer outro.';
comment on table public.project_items is
  'O que a obra precisa. Quantidade comprada e status NAO sao colunas: saem da soma das compras.';
comment on table public.project_quotes is
  'Propostas de fornecedor para um item. No maximo uma escolhida, garantido por indice parcial.';
comment on table public.project_purchases is
  'O que ja foi comprado de um item, com quantidade. `transaction_id` opcional: obra se paga muito fora do cartao.';
