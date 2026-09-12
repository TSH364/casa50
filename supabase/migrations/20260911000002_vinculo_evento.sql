-- ===========================================================================
-- Vinculo entre lancamento e compromisso da agenda
--
-- Ate aqui a associacao era so uma coincidencia de data: o app somava tudo que
-- caiu nos dias do evento e dizia isso com todas as letras ("gasto NOS DIAS
-- dele"). Honesto, mas impreciso - a assinatura que cobra dia 12 entrava na
-- conta de uma viagem que comecou dia 11, e a estimativa de quanto custa a
-- proxima viagem herdava o erro.
--
-- Estas duas colunas deixam a casa corrigir o palpite, uma linha por vez. Sao
-- TRES estados, e por isso duas colunas e nao uma:
--
--   decidido = false                  -> ninguem opinou; vale o palpite por data
--   decidido = true  + evento tal     -> e deste compromisso, confirmado
--   decidido = true  + evento nulo    -> nao e de compromisso nenhum
--
-- O terceiro estado e o que mais importa e o que uma coluna so nao expressa:
-- sem ele, "nao vinculado" seria indistinguivel de "ainda nao perguntaram", e
-- o app continuaria contando o que a pessoa ja disse que nao conta.
--
-- `on delete set null`: se o compromisso sumir da agenda do Google, o
-- lancamento continua intacto e apenas volta a nao ter evento. A decisao de
-- "nao e de evento nenhum" sobrevive, porque mora na outra coluna.
-- ===========================================================================

alter table public.transactions
  add column if not exists calendar_event_id uuid
    references public.calendar_events (id) on delete set null,
  add column if not exists event_link_decided boolean not null default false;

-- A consulta e sempre "o que foi confirmado para este evento".
create index if not exists transactions_calendar_event
  on public.transactions (calendar_event_id)
  where calendar_event_id is not null;

comment on column public.transactions.calendar_event_id is
  'Compromisso a que este lancamento pertence, quando alguem confirmou. Nulo com event_link_decided = true significa "nao e de evento nenhum".';
comment on column public.transactions.event_link_decided is
  'Verdadeiro quando uma pessoa decidiu o vinculo. Falso deixa valer o palpite por data.';
