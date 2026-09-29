-- Fluxo - Financas do Casal :: diagnostico da pesquisa de compra
--
-- A pesquisa de compra roda no servidor da Vercel, e quando ela volta vazia
-- nao ha como saber por que: a resposta da busca nao fica em lugar nenhum.
-- `details` guarda o que a PESQUISA viu - o produto pedido, os enderecos e
-- titulos das paginas, se o trecho tinha preco, o comeco da resposta da IA.
-- Nada da casa: nenhum valor, categoria, pessoa ou lancamento entra aqui.
--
-- Teto de 16 KB: e diagnostico, nao arquivo.

alter table public.ai_usage
  add column if not exists details jsonb
  check (details is null or pg_column_size(details) <= 16384);

comment on column public.ai_usage.details is
  'Diagnostico da operacao (so a pesquisa de compra usa): o que a busca na web devolveu, sem dado da casa.';
