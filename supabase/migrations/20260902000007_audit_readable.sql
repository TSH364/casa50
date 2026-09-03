-- ===========================================================================
-- Fluxo :: 0007 auditoria mais legível
--
-- Dois defeitos encontrados testando a tela de histórico:
--
-- 1. Campos apareciam com o nome da coluna ("credit_limit de R$ 2.000,00
--    para R$ 2.300,00"). A secao 19 pede texto humano.
-- 2. `created_at default now()` devolve o horário de INÍCIO da transação, e
--    não o instante da linha. Todos os registros gravados juntos - uma
--    importação, por exemplo - ficavam com o mesmo carimbo, e a ordenação
--    do histórico virava arbitrária. `clock_timestamp()` resolve.
--
-- `describe_diff` é redefinida aqui e novamente na 0008, que acrescenta o
-- rótulo do registro. A versão final é a da 0008.
-- ===========================================================================

alter table public.audit_log
  alter column created_at set default clock_timestamp();

create or replace function app.field_label(field text)
returns text language sql immutable as $fn$
  select case field
    when 'amount'               then 'o valor'
    when 'limit_amount'         then 'o limite'
    when 'credit_limit'         then 'o limite'
    when 'target_amount'        then 'o valor da meta'
    when 'monthly_contribution' then 'o aporte mensal'
    when 'installment_value'    then 'o valor da parcela'
    when 'reported_total'       then 'o total informado pelo banco'
    when 'share_amount'         then 'o valor da divisão'
    when 'description'          then 'a descrição'
    when 'name'                 then 'o nome'
    when 'date'                 then 'a data'
    when 'invoice_month'        then 'o mês da fatura'
    when 'type'                 then 'o tipo'
    when 'status'               then 'a situação'
    when 'note'                 then 'a observação'
    when 'merchant_alias'       then 'o apelido'
    when 'visibility'           then 'a visibilidade'
    when 'split_type'           then 'a divisão'
    when 'is_hidden'            then 'a exibição'
    when 'is_active'            then 'a situação'
    when 'is_reconciled'        then 'a conciliação'
    when 'closing_day'          then 'o dia de fechamento'
    when 'due_day'              then 'o dia de vencimento'
    when 'institution'          then 'a instituição'
    when 'last_four'            then 'os 4 últimos dígitos'
    when 'brand'                then 'a bandeira'
    when 'color'                then 'a cor'
    when 'icon'                 then 'o ícone'
    when 'next_date'            then 'a próxima cobrança'
    when 'expected_day'         then 'o dia esperado'
    when 'interval'             then 'a frequência'
    when 'target_date'          then 'o prazo'
    when 'pattern'              then 'o padrão'
    when 'installment_current'  then 'a parcela'
    when 'installment_total'    then 'o total de parcelas'
    when 'file_name'            then 'o arquivo'
    when 'confidence'           then 'a confiança'
    else field
  end;
$fn$;

-- Traduz valores de enum que apareceriam em inglês para o casal.
create or replace function app.value_label(field text, value text)
returns text language sql immutable as $fn$
  select case
    when value is null then 'vazio'
    when field = 'type' then case value
      when 'expense' then 'despesa' when 'income' then 'receita'
      when 'payment' then 'pagamento' when 'refund' then 'estorno'
      when 'fee' then 'tarifa' when 'adjustment' then 'ajuste' else value end
    when field = 'status' then case value
      when 'forecast' then 'previsto' when 'confirmed' then 'confirmado'
      when 'cancelled' then 'cancelado' when 'missing' then 'ausente'
      when 'divergent' then 'divergente' when 'imported' then 'importada'
      when 'reverted' then 'desfeita' when 'pending' then 'pendente'
      when 'active' then 'ativa' when 'completed' then 'concluída'
      when 'paused' then 'pausada' else value end
    when field = 'visibility' then case value
      when 'shared' then 'compartilhado' when 'individual' then 'individual'
      else value end
    when field = 'split_type' then case value
      when 'none' then 'sem divisão' when 'equal' then 'meio a meio'
      when 'income_proportional' then 'proporcional à renda'
      when 'custom' then 'personalizada' else value end
    when field = 'interval' then case value
      when 'weekly' then 'semanal' when 'monthly' then 'mensal'
      when 'yearly' then 'anual' else value end
    when field in ('is_hidden', 'is_active', 'is_reconciled') then case value
      when 'true' then 'sim' when 'false' then 'não' else value end
    else value
  end;
$fn$;

-- Nomes por trás dos identificadores, para o histórico não exibir UUID.
create or replace function app.profile_name(p_id uuid)
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select nullif(btrim(full_name), '') from public.profiles where id = p_id;
$fn$;

create or replace function app.card_name(p_id uuid)
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select name from public.cards where id = p_id;
$fn$;
