-- De onde veio a categoria de cada lancamento.
--
-- Separa o que a CASA decidiu (a mao, por regra dela, loja conhecida ou pelo
-- historico) do que foi palpite (Jev, dica do banco). O historico da loja so
-- conta o primeiro grupo: sem essa marca, um palpite errado do Jev viraria
-- "historico" no mes seguinte e se repetiria para sempre.
--
-- Nulo = lancamento anterior a esta marcacao; conta como decisao da casa,
-- porque ate aqui toda importacao passava pela revisao.
alter table public.transactions
  add column category_source text
  check (category_source in ('casa', 'regra', 'loja', 'historico', 'banco', 'tipo', 'jev'));

comment on column public.transactions.category_source is
  'De onde veio a categoria: casa, regra, loja, historico, banco, tipo ou jev. Nulo = anterior a marcacao.';

-- Regra aprendida com confidence < 1 veio do Jev (palpite confirmado na
-- importacao); 1 e regra da casa. A correcao da casa sempre grava 1 e passa
-- por cima.
comment on column public.learned_rules.confidence is
  '1 = regra da casa; abaixo de 1 = palpite do Jev confirmado na importacao (a certeza dele).';
