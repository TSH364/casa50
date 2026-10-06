-- ===========================================================================
-- A categoria das despesas que o projeto lanca
--
-- Desde a v0.8.0, compra de obra paga por boleto, pix ou dinheiro vira um
-- lancamento no mes. Mas entrava SEM CATEGORIA - e uma despesa sem categoria
-- de R$ 4.000 de pintura nao entra no orcamento de nada, aparece como "sem
-- categoria" no inicio, e pede que alguem va ate Extratos classificar cada
-- uma, uma por uma, pelo resto da obra.
--
-- NO PROJETO, e nao na compra: uma obra inteira cai na mesma categoria, e
-- perguntar a cada compra seria mais um campo num formulario de celular para
-- responder sempre a mesma coisa. Quem quiser separar ainda pode, no extrato.
--
-- `on delete set null`: apagar a categoria nao apaga o projeto. As despesas
-- seguintes voltam a entrar sem categoria, que e o comportamento de antes.
-- ===========================================================================

alter table public.projects
  add column if not exists category_id uuid
    references public.categories (id) on delete set null;

comment on column public.projects.category_id is
  'Categoria das despesas que o app lanca a partir das compras deste projeto (boleto, pix, dinheiro).';
