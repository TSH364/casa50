-- ===========================================================================
-- Categoria que nao conta nos totais da casa
--
-- Motivo concreto: numa casa com 596 lancamentos importados, a categoria de
-- trabalho respondia por 49% do gasto. Isso nao e um detalhe de exibicao - ela
-- distorce TUDO que o app calcula: a rosca, a matriz mes x categoria, a
-- previsao, a sugestao de orcamento e a linha de base de "quanto custa um dia
-- comum" que a agenda usa para estimar viagem. Com metade do dinheiro sendo
-- despesa de empresa, nenhuma dessas contas descreve a vida do casal.
--
-- A marca fica na CATEGORIA, e nao numa preferencia de tela, porque a decisao
-- e sobre o que aquela categoria e: "isto nao e gasto da casa". Vale para as
-- duas pessoas, sobrevive a troca de aparelho e nao precisa ser repetida em
-- cada pagina.
--
-- Os lancamentos continuam existindo, visiveis e editaveis em Extratos. O que
-- muda e so se eles entram nos totais - e cada tela afetada diz, por escrito,
-- que esta deixando algo de fora, com um jeito de ver incluido.
-- ===========================================================================

alter table public.categories
  add column if not exists excluded_from_totals boolean not null default false;

comment on column public.categories.excluded_from_totals is
  'Quando verdadeiro, os lancamentos desta categoria nao entram nos totais, medias e previsoes da casa. Continuam visiveis em Extratos.';
