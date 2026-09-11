-- ===========================================================================
-- Guardar o final do cartao que veio no arquivo (secao 6)
--
-- Mesmo motivo de `category_hint`, na migracao anterior: o que o arquivo diz
-- precisa sobreviver ao arquivo, senao a reanalise de uma fatura ja importada
-- nao alcanca aquilo. `card_id` e a decisao; `card_last_four` e o dado cru,
-- que permite refazer a ligacao depois - inclusive para linhas gravadas sem
-- cartao, quando a importacao ainda nao criava cartao sozinha.
--
-- Coluna anulavel e sem default: o ADD COLUMN nao reescreve a tabela. Linhas
-- gravadas antes desta migracao ficam com NULL, e para elas nao ha o que
-- reanalisar - o dado nunca foi guardado.
-- ===========================================================================

alter table public.transactions
  add column if not exists card_last_four text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'transactions_card_last_four_format'
  ) then
    alter table public.transactions
      add constraint transactions_card_last_four_format
      check (card_last_four is null or card_last_four ~ '^[0-9]{4}$');
  end if;
end $$;

comment on column public.transactions.card_last_four is
  'Final do cartao como veio no arquivo importado. Dado cru: `card_id` e a decisao, este campo permite refazer a ligacao sem o arquivo.';
