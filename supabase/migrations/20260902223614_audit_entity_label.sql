-- ===========================================================================
-- Fluxo :: 0008 rótulo do registro na auditoria
--
-- Orçamento e acerto não têm `name` nem `description`, então o histórico
-- dizia "criou orcamento" - o nome da tabela. A secao 19 quer o registro
-- identificado por algo que o casal reconheça:
--
--   "Vinicius alterou o orçamento de Alimentação: o limite de R$ 2.000,00
--    para R$ 2.300,00"
--
-- Esta migration traz a versão final de `describe_diff` e `audit_change`.
-- ===========================================================================

create or replace function app.entity_label(p_entity text, p_data jsonb)
returns text language sql stable
set search_path = public, extensions, pg_temp as $fn$
  select coalesce(
    p_data ->> 'description',
    p_data ->> 'name',
    p_data ->> 'pattern',
    p_data ->> 'file_name',
    -- Orçamento: identificado pela categoria que ele limita.
    case when p_entity = 'orcamento' and (p_data ->> 'category_id') is not null
         then 'o orçamento de ' ||
              coalesce(app.category_name((p_data ->> 'category_id')::uuid), 'uma categoria')
    end,
    case when p_entity = 'acerto' then 'o acerto do mês' end,
    p_entity
  );
$fn$;

create or replace function app.describe_diff(
  p_entity text, p_before jsonb, p_after jsonb
) returns text language plpgsql stable
set search_path = public, extensions, pg_temp as $fn$
declare
  v_label text := app.entity_label(p_entity, p_after);
  v_parts text[] := '{}';
  v_key   text;
  v_old   text;
  v_new   text;
  -- Colunas técnicas, derivadas ou sem valor para o leitor humano.
  v_ignored text[] := array[
    'updated_at', 'created_at', 'merchant_normalized', 'duplicate_key',
    'id', 'house_id', 'created_by', 'invoice_id', 'recurring_id',
    'merchant_original', 'computed_total', 'file_hash', 'sort_order',
    'parent_id', 'reconciled_with_id', 'goal_id', 'transaction_id'
  ];
begin
  for v_key in select jsonb_object_keys(p_after) loop
    continue when v_key = any (v_ignored);
    v_old := p_before ->> v_key;
    v_new := p_after ->> v_key;
    continue when v_old is not distinct from v_new;

    if v_key in ('category_id', 'subcategory_id') then
      v_parts := v_parts || format('%s de %s para %s',
        case when v_key = 'category_id' then 'a categoria' else 'a subcategoria' end,
        coalesce(app.category_name(v_old::uuid), 'sem categoria'),
        coalesce(app.category_name(v_new::uuid), 'sem categoria'));

    elsif v_key in ('member_id', 'owner_id', 'from_member', 'to_member') then
      v_parts := v_parts || format('o responsável de %s para %s',
        coalesce(app.profile_name(v_old::uuid), 'ninguém'),
        coalesce(app.profile_name(v_new::uuid), 'ninguém'));

    elsif v_key = 'card_id' then
      v_parts := v_parts || format('o cartão de %s para %s',
        coalesce(app.card_name(v_old::uuid), 'nenhum'),
        coalesce(app.card_name(v_new::uuid), 'nenhum'));

    elsif v_key in ('amount', 'limit_amount', 'target_amount', 'credit_limit',
                    'monthly_contribution', 'installment_value', 'reported_total',
                    'share_amount') then
      v_parts := v_parts || format('%s de %s para %s',
        app.field_label(v_key), app.money_br(v_old::numeric),
        app.money_br(v_new::numeric));

    -- Outro identificador qualquer: dizer que mudou, sem exibir o UUID.
    elsif v_key like '%\_id' then
      v_parts := v_parts || app.field_label(v_key);

    else
      v_parts := v_parts || format('%s de "%s" para "%s"',
        app.field_label(v_key),
        app.value_label(v_key, v_old),
        app.value_label(v_key, v_new));
    end if;
  end loop;

  if array_length(v_parts, 1) is null then
    return null;
  end if;

  return format('alterou %s: %s', v_label, array_to_string(v_parts, '; '));
end;
$fn$;

create or replace function app.audit_change()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_entity  text := coalesce(tg_argv[0], tg_table_name);
  v_house   uuid;
  v_action  audit_action;
  v_summary text;
  v_before  jsonb;
  v_after   jsonb;
begin
  if coalesce(current_setting('app.skip_audit', true), 'off') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_house  := old.house_id;
    v_action := 'delete';
    v_summary := format('excluiu %s%s', app.entity_label(v_entity, v_before),
      case when v_before ? 'amount'
           then ' de ' || app.money_br((v_before ->> 'amount')::numeric)
           else '' end);

  elsif tg_op = 'INSERT' then
    v_after  := to_jsonb(new);
    v_house  := new.house_id;
    v_action := 'create';
    v_summary := format('criou %s%s', app.entity_label(v_entity, v_after),
      case when v_after ? 'amount'
           then ' de ' || app.money_br((v_after ->> 'amount')::numeric)
           else '' end);

  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_house  := new.house_id;
    v_summary := app.describe_diff(v_entity, v_before, v_after);
    -- Nada relevante mudou: não poluir o histórico.
    if v_summary is null then
      return new;
    end if;
    v_action := case
      when (v_before ->> 'category_id') is distinct from (v_after ->> 'category_id')
      then 'categorize'::audit_action else 'update'::audit_action end;
  end if;

  insert into public.audit_log (house_id, user_id, entity, entity_id, action, summary, before_data, after_data)
  values (v_house, auth.uid(), v_entity,
          coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid),
          v_action, v_summary, v_before, v_after);

  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;
