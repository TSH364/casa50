-- ===========================================================================
-- Fluxo :: 0004 nao auditar as categorias semeadas
--
-- Descoberto testando 0003 contra o banco real: criar uma casa gerava 14
-- linhas de auditoria ("criou Moradia", "criou Alimentacao", ...), porque o
-- trigger dispara em cada categoria inicial. Isso e dado semeado, nao acao de
-- usuario, e polui o historico legivel da secao 19.
--
-- app.bootstrap_house() liga um sinalizador de transacao que o trigger de
-- auditoria respeita. Por ser `local` (terceiro argumento de set_config), ele
-- desaparece ao fim da transacao e nunca vaza para a operacao seguinte.
-- ===========================================================================

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
  if coalesce(current_setting('app.skip_audit', true), 'off') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

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

create or replace function app.bootstrap_house()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
begin
  perform set_config('app.skip_audit', 'on', true);

  insert into public.house_members (house_id, user_id, role, status, joined_at)
  values (new.id, new.owner_id, 'owner', 'active', now());

  insert into public.categories (house_id, name, color, icon, sort_order)
  values
    (new.id, 'Moradia',     '#7C86FF', 'house',        1),
    (new.id, 'Alimentacao', '#F0A44A', 'utensils',     2),
    (new.id, 'Transporte',  '#4FB6E8', 'car',          3),
    (new.id, 'Saude',       '#5FD3A6', 'heart-pulse',  4),
    (new.id, 'Educacao',    '#9B7BE8', 'graduation-cap', 5),
    (new.id, 'Lazer',       '#F07AA8', 'party-popper', 6),
    (new.id, 'Assinaturas', '#5EC8C0', 'repeat',       7),
    (new.id, 'Compras',     '#E8A0D8', 'shopping-bag', 8),
    (new.id, 'Viagens',     '#67A6F5', 'plane',        9),
    (new.id, 'Servicos',    '#8FA0B8', 'wrench',      10),
    (new.id, 'Tarifas',     '#D8925E', 'receipt',     11),
    (new.id, 'Impostos',    '#C9737A', 'landmark',    12),
    (new.id, 'TSH',         '#A5B3C4', 'briefcase',   13),
    (new.id, 'Outros',      '#8B8B94', 'circle-dashed', 99);

  perform set_config('app.skip_audit', 'off', true);
  return new;
end;
$fn$;
