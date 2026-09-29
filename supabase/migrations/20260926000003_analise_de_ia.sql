-- Fluxo - Financas do Casal :: a analise do mes feita por IA, na aba Insights
--
-- O botao "Analisar com IA" gasta uma chamada paga. Guardar o resultado por
-- mes faz a analise valer para a casa inteira: quem abre Insights depois ve
-- a mesma leitura, com a data em que foi feita, sem pagar de novo.
--
-- So insercao. Refazer cria uma linha nova e a tela mostra a mais recente -
-- a anterior fica como historico, e ninguem sobrescreve a do outro.

create table if not exists public.ai_insights (
  id          uuid primary key default gen_random_uuid(),
  house_id    uuid not null references public.houses (id) on delete cascade,
  month       text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- O recorte dos totais: 'casa' (sem as categorias que nao contam) ou
  -- 'tudo'. Analises de recortes diferentes nao se misturam.
  scope       text not null default 'casa' check (scope in ('casa', 'tudo')),
  -- As analises ja validadas, com a evidencia copiada dos fatos do app.
  -- Teto de tamanho: e texto curto, e o teto impede usar a tabela de deposito.
  content     jsonb not null check (pg_column_size(content) <= 32768),
  model       text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists ai_insights_by_month
  on public.ai_insights (house_id, month, scope, created_at desc);

alter table public.ai_insights enable row level security;

drop policy if exists ai_insights_select on public.ai_insights;
create policy ai_insights_select on public.ai_insights
  for select to authenticated using (app.is_member(house_id));

-- Inserir: quem pode escrever na casa (e quem tem a chave da IA), em nome
-- de si mesmo.
drop policy if exists ai_insights_insert on public.ai_insights;
create policy ai_insights_insert on public.ai_insights
  for insert to authenticated
  with check (app.can_write(house_id) and created_by = (select auth.uid()));

comment on table public.ai_insights is
  'Analises do mes feitas por IA na aba Insights. So insercao; a tela mostra a mais recente por mes e recorte.';

-- O gasto dessa analise entra no registro de gasto de IA com nome proprio.
alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in ('orcamento', 'jev', 'conversa_gratuita', 'conversa_paga', 'insights'));
