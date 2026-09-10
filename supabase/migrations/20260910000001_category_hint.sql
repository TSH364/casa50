-- ===========================================================================
-- Guardar a categoria que o banco mandou no arquivo (secao 6)
--
-- A reanalise de uma fatura ja importada so alcancava regra aprendida, nome do
-- estabelecimento e tipo. A categoria que veio no CSV era usada na importacao
-- e jogada fora, entao as linhas que dependiam exclusivamente dela ficavam
-- fora do alcance do botao "Reanalisar" - a unica saida era desfazer a
-- importacao e importar o arquivo de novo, perdendo os ajustes manuais.
--
-- E so a dica crua, como o banco escreveu ("Supermercados / Mercearia /
-- Padarias / Lojas de Conveniencia"). Nao substitui `category_id`: continua
-- sendo palpite, e quem decide e a casa.
--
-- Coluna anulavel e sem default: o ADD COLUMN nao reescreve a tabela, e as
-- linhas ja gravadas ficam com NULL, que a resolucao ja trata como ausencia.
-- ===========================================================================

alter table public.transactions
  add column if not exists category_hint text;

comment on column public.transactions.category_hint is
  'Categoria como o banco escreveu no arquivo importado. Palpite, nunca decisao: serve para reanalisar a fatura sem precisar do arquivo de novo.';
