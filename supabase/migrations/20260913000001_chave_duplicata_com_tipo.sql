-- ---------------------------------------------------------------------------
-- A chave de duplicidade precisa do TIPO do lancamento.
--
-- O defeito, MEDIDO na base real: "MERCADOLIVRE*CIAPNEUS" cobra R$ 473,73 em
-- 10/05/2026 e estorna os mesmos R$ 473,73 no mesmo dia. A fatura de junho
-- traz as DUAS linhas.
--
-- O valor e gravado em modulo - o sinal da fatura vira o TIPO do lancamento -
-- entao a cobranca e o estorno chegavam nesta chave com mes, data, loja,
-- cartao, parcela e valor todos iguais. Chave identica, e a segunda linha
-- descartada como repetida. O banco ficou so com o estorno, e junho passou a
-- subtrair R$ 473,73 que nunca foram gastos.
--
-- Cobranca e estorno sao fatos diferentes, e a chave precisa dizer isso.
--
-- O QUE NAO MUDA: duas despesas iguais no mesmo dia e na mesma loja continuam
-- batendo na mesma chave. Ali a duvida e real - pode ser importacao repetida
-- ou duas compras iguais - e quem decide e a tela de revisao, nunca o banco.
--
-- POR QUE ESTA MIGRACAO EXISTE, sendo que a correcao ja esta no TypeScript:
-- o app NAO le a coluna `duplicate_key`. Na importacao ele recalcula a chave
-- em memoria a partir das colunas cruas (ver `existingByKey` em
-- src/actions/import.ts), entao junho ja fica correto sem mexer no banco.
--
-- Esta funcao e a SEGUNDA copia da mesma regra, e o indice
-- `transactions_duplicate_lookup` existe para ser usado. Deixar as duas
-- discordando guarda uma armadilha para quem for usar a coluna depois: ela
-- responderia "mesma linha" onde o app responde "linhas diferentes". Duas
-- copias da mesma regra divergindo e como o total da fatura ja saiu errado
-- antes neste projeto.
-- ---------------------------------------------------------------------------

create or replace function app.fill_transaction_keys()
returns trigger language plpgsql
set search_path = public, extensions, pg_temp as $fn$
begin
  new.merchant_normalized := app.trim_merchant(coalesce(new.merchant_original, new.description));
  new.duplicate_key := encode(digest(
    concat_ws('|',
      new.house_id::text,
      to_char(new.invoice_month, 'YYYY-MM'),
      to_char(new.date, 'YYYY-MM-DD'),
      coalesce(new.merchant_normalized, ''),
      to_char(new.amount, 'FM9999999990.00'),
      new.type::text,
      coalesce(new.card_id::text, ''),
      coalesce(new.installment_current::text, ''),
      coalesce(new.installment_total::text, '')
    ), 'sha256'), 'hex');
  return new;
end;
$fn$;

-- Recalcula as chaves ja gravadas. Sem isto, as linhas antigas continuariam
-- com a chave velha e uma importacao futura as compararia contra chaves novas
-- - nenhuma bateria, e toda linha ja existente voltaria a aparecer como nova.
--
-- O `update` dispara o proprio trigger acima, que reescreve a coluna. Mexe so
-- em `duplicate_key` e `merchant_normalized`, que a auditoria ja ignora
-- (ver 20260902000003_audit.sql), entao nao gera ruido no historico.
update public.transactions set updated_at = updated_at;
