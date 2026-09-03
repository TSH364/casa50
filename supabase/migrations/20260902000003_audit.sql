-- ===========================================================================
-- Fluxo - Financas do Casal :: 0003 auditoria
--
-- Secao 19: a interface mostra texto humano, mas o JSON antes/depois fica
-- guardado para rastreabilidade. O trigger produz os dois de uma vez.
--
-- A auditoria e feita por trigger e nao pela aplicacao de proposito: assim
-- ela registra tambem alteracoes feitas por script, RPC ou pelo painel do
-- Supabase, e nao apenas as que passam pela interface.
-- ===========================================================================

create or replace function app.money_br(v numeric)
returns text language sql immutable as $fn$
  select case
    when v is null then 'sem valor'
    else 'R$ ' || replace(replace(replace(to_char(v, 'FM999G999G990D00'), '.', '#'), ',', '.'), '#', ',')
  end;
$fn$;

create or replace function app.category_name(p_id uuid)
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select name from public.categories where id = p_id;
$fn$;

-- Descreve, em portugues, o que mudou entre duas versoes de um registro.
-- Retorna null quando nada relevante mudou (updated_at nao conta).
create or replace function app.describe_diff(
  p_entity text, p_before jsonb, p_after jsonb
) returns text language plpgsql stable as $fn$
declare
  v_label text;
  v_parts text[] := '{}';
  v_key   text;
  v_old   text;
  v_new   text;
  v_ignored text[] := array['updated_at', 'created_at', 'merchant_normalized', 'duplicate_key'];
begin
  v_label := coalesce(
    p_after ->> 'description', p_after ->> 'name', p_after ->> 'pattern',
    p_after ->> 'file_name', p_entity
  );

  for v_key in select jsonb_object_keys(p_after) loop
    continue when v_key = any (v_ignored);
    v_old := p_before ->> v_key;
    v_new := p_after ->> v_key;
    continue when v_old is not distinct from v_new;

    -- Campos que ficam ilegiveis como UUID cru ganham traducao.
    if v_key in ('category_id', 'subcategory_id') then
      v_parts := v_parts || format('%s de %s para %s',
        case when v_key = 'category_id' then 'categoria' else 'subcategoria' end,
        coalesce(app.category_name(v_old::uuid), 'sem categoria'),
        coalesce(app.category_name(v_new::uuid), 'sem categoria'));
    elsif v_key in ('amount', 'limit_amount', 'target_amount', 'credit_limit', 'monthly_contribution') then
      v_parts := v_parts || format('%s de %s para %s',
        v_key, app.money_br(v_old::numeric), app.money_br(v_new::numeric));
    else
      v_parts := v_parts || format('%s de "%s" para "%s"',
        v_key, coalesce(v_old, 'vazio'), coalesce(v_new, 'vazio'));
    end if;
  end loop;

  if array_length(v_parts, 1) is null then
    return null;
  end if;

  return format('alterou %s: %s', v_label, array_to_string(v_parts, '; '));
end;
$fn$;

-- Trigger generico de auditoria. Cada tabela o instala informando o nome da
-- entidade como argumento.
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
  v_label   text;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_house  := old.house_id;
    v_action := 'delete';
    v_label  := coalesce(v_before ->> 'description', v_before ->> 'name',
                         v_before ->> 'pattern', v_entity);
    v_summary := format('excluiu %s%s', v_label,
      case when v_before ? 'amount'
           then ' de ' || app.money_br((v_before ->> 'amount')::numeric)
           else '' end);

  elsif tg_op = 'INSERT' then
    v_after  := to_jsonb(new);
    v_house  := new.house_id;
    v_action := 'create';
    v_label  := coalesce(v_after ->> 'description', v_after ->> 'name',
                         v_after ->> 'pattern', v_entity);
    v_summary := format('criou %s%s', v_label,
      case when v_after ? 'amount'
           then ' de ' || app.money_br((v_after ->> 'amount')::numeric)
           else '' end);

  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_house  := new.house_id;
    v_summary := app.describe_diff(v_entity, v_before, v_after);
    -- Nada de relevante mudou: nao poluir o historico.
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

-- --------------------------------------------------------------------------
-- Instalacao nas entidades que a secao 19 exige rastrear.
-- --------------------------------------------------------------------------
do $do$
declare
  pair text[];
begin
  -- Nome da tabela e rotulo humano da entidade. O rotulo e escrito a mao
  -- porque tirar o "s" final quebraria "categories" -> "categorie".
  foreach pair slice 1 in array array[
    ['transactions',  'lancamento'],
    ['cards',         'cartao'],
    ['categories',    'categoria'],
    ['budgets',       'orcamento'],
    ['goals',         'meta'],
    ['recurrences',   'recorrencia'],
    ['learned_rules', 'regra'],
    ['invoices',      'fatura'],
    ['settlements',   'acerto']
  ] loop
    execute format(
      'create trigger %1$s_audit after insert or update or delete on public.%1$I
         for each row execute function app.audit_change(%2$L);', pair[1], pair[2]);
  end loop;
end;
$do$;
