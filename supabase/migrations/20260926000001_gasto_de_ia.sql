-- Fluxo - Financas do Casal :: quanto a IA gasta, e com que
--
-- O OpenRouter informa o gasto da CHAVE (hoje, semana, mes, total), mas nao
-- sabe para que foi cada chamada. Esta tabela e o outro lado: uma linha por
-- operacao do app que chamou IA, com o custo que o proprio OpenRouter
-- devolveu na resposta (`usage.cost`). E ela que permite dizer "a conversa
-- paga custou tanto este mes; o Jev, tanto".
--
-- Livro-razao, e nao contador: so insercao. Linha nao se corrige nem se
-- apaga - um gasto que aconteceu nao deixa de ter acontecido.

create table if not exists public.ai_usage (
  id          uuid primary key default gen_random_uuid(),
  house_id    uuid not null references public.houses (id) on delete cascade,
  -- Para que foi. Lista fechada: a tela agrupa por aqui.
  feature     text not null check (feature in ('orcamento', 'jev', 'conversa_gratuita', 'conversa_paga')),
  -- O modelo que respondeu (o roteador gratuito escolhe um a cada vez).
  model       text,
  -- Quantas chamadas ao OpenRouter a operacao fez (uma conversa com duas
  -- consultas sao tres). Importa para a cota do gratuito, que conta chamadas.
  calls       integer not null default 1 check (calls >= 1),
  -- Em dolar, a moeda dos creditos do OpenRouter. Seis casas: uma chamada do
  -- Jev custa cerca de US$ 0,00002.
  cost_usd    numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists ai_usage_by_house_month on public.ai_usage (house_id, created_at desc);

alter table public.ai_usage enable row level security;

-- Ler: quem e da casa.
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage
  for select to authenticated using (app.is_member(house_id));

-- Inserir: quem e da casa, e so em nome de si mesmo. (Em politica de RLS o
-- NULL de `is_member` para quem e de fora ja conta como recusa - o cuidado
-- com `is not true` e para PL/pgSQL, ver 20260925000002.)
drop policy if exists ai_usage_insert on public.ai_usage;
create policy ai_usage_insert on public.ai_usage
  for insert to authenticated
  with check (app.is_member(house_id) and created_by = (select auth.uid()));

-- Sem update e sem delete: livro-razao.

comment on table public.ai_usage is
  'Uma linha por operacao do app que chamou IA, com o custo devolvido pelo OpenRouter. So insercao.';
