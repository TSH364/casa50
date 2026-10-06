-- ===========================================================================
-- A conta que NAO passa no cartao
--
-- O caso que originou isto: a parcela do financiamento da casa, R$ 2.200 por
-- mes, comecou em setembro/2026. Ela esta cadastrada como recorrencia e nunca
-- vai aparecer numa fatura, porque se paga por boleto.
--
-- DOIS ESTRAGOS, MEDIDOS na base real antes de mexer:
--
--   1. R$ 2.200 por mes INVISIVEIS. A base tem ZERO lancamentos manuais - tudo
--      que o app conhece veio de fatura de cartao - entao a maior despesa fixa
--      da casa nao entra em total do mes, calendario, orcamento de Moradia nem
--      comparacao mes a mes. O app achava que a casa gastava R$ 2.200 a menos
--      do que gasta.
--   2. ALARME FALSO PERMANENTE. A conciliacao marca "ausente" toda recorrencia
--      que passou do dia esperado sem lancamento correspondente. Como nenhuma
--      fatura jamais vai trazer um boleto, esta ficaria ausente todo mes, para
--      sempre - e um aviso que nunca sai ensina a ignorar todos os outros.
--
-- A MARCA, e nao uma deducao a partir de `card_id is null`: cartao nulo
-- tambem acontece por descuido de cadastro, e uma regra implicita faria o app
-- comecar a lancar dinheiro sozinho por causa de um campo que alguem esqueceu.
-- Dizer "esta conta nao vem por fatura" e uma decisao, e decisao se declara.
-- ===========================================================================

alter table public.recurrences
  add column if not exists off_card boolean not null default false;

comment on column public.recurrences.off_card is
  'A conta nao chega por fatura de cartao (boleto, debito, pix). O app lanca a previsao dela; a casa confirma o valor pago.';

-- ---------------------------------------------------------------------------
-- A trava que torna o lancamento automatico seguro de repetir.
--
-- Sem ela, dois toques no botao - ou duas abas abertas - criariam duas
-- parcelas do mesmo mes, e dinheiro duplicado num historico e pior que
-- dinheiro faltando: o que falta se percebe, o que sobra parece gasto.
--
-- Com ela, a geracao pode ser chamada quantas vezes for: a segunda nao
-- escreve nada. E o mesmo principio do `duplicate_key` da importacao, so que
-- aqui garantido pelo banco em vez de conferido antes.
--
-- Restrita a `origin = 'recurrence'` para nao impedir que a casa lance a mao,
-- no mesmo mes, um pagamento extra da mesma conta.
-- ---------------------------------------------------------------------------
create unique index if not exists transactions_uma_previsao_por_recorrencia_mes
  on public.transactions (house_id, recurring_id, invoice_month)
  where recurring_id is not null and origin = 'recurrence';
