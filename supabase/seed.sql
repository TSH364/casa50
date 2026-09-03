-- ===========================================================================
-- Fluxo :: dados de demonstracao
--
-- ATENCAO: dados FICTICIOS, para desenvolvimento local apenas.
-- Nenhum dado financeiro real do casal entra neste arquivo - ele e versionado
-- no git e roda a cada `supabase db reset`.
--
-- Senha das duas contas de teste: fluxo1234
-- ===========================================================================

set search_path = public, extensions;

do $seed$
declare
  v_vini   uuid := '11111111-1111-4111-8111-111111111111';
  v_lari   uuid := '22222222-2222-4222-8222-222222222222';
  v_house  uuid;
  v_nubank uuid;
  v_itau   uuid;
  v_mes    date := date_trunc('month', current_date)::date;
  v_ant    date := (date_trunc('month', current_date) - interval '1 month')::date;
  c_alim   uuid; c_transp uuid; c_assin uuid; c_moradia uuid; c_lazer uuid;
begin
  -- ---------------------------------------------------------------------
  -- Contas de teste. Inserir direto em auth.users so e aceitavel aqui
  -- porque este seed nunca roda em producao.
  -- ---------------------------------------------------------------------
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values
    (v_vini, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'vinicius@exemplo.test', crypt('fluxo1234', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Vinicius"}'::jsonb, now(), now()),
    (v_lari, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'larissa@exemplo.test', crypt('fluxo1234', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Larissa"}'::jsonb, now(), now())
  on conflict (id) do nothing;

  -- O trigger on_auth_user_created ja criou os perfis; garantimos os nomes.
  insert into public.profiles (id, full_name, email) values
    (v_vini, 'Vinicius', 'vinicius@exemplo.test'),
    (v_lari, 'Larissa',  'larissa@exemplo.test')
  on conflict (id) do update set full_name = excluded.full_name;

  -- ---------------------------------------------------------------------
  -- Casa. O trigger houses_bootstrap torna Vinicius owner e semeia as
  -- categorias iniciais - por isso nao inserimos nem membro nem categoria.
  -- ---------------------------------------------------------------------
  insert into public.houses (name, owner_id) values ('Casa 50', v_vini)
  returning id into v_house;

  insert into public.house_members (house_id, user_id, role, status, joined_at)
  values (v_house, v_lari, 'admin', 'active', now());

  select id into c_alim    from public.categories where house_id = v_house and name = 'Alimentacao';
  select id into c_transp  from public.categories where house_id = v_house and name = 'Transporte';
  select id into c_assin   from public.categories where house_id = v_house and name = 'Assinaturas';
  select id into c_moradia from public.categories where house_id = v_house and name = 'Moradia';
  select id into c_lazer   from public.categories where house_id = v_house and name = 'Lazer';

  -- ---------------------------------------------------------------------
  -- Cartoes. O dono e um campo proprio, nao inferido de quem importou.
  -- ---------------------------------------------------------------------
  insert into public.cards (house_id, name, institution, last_four, brand, owner_id, closing_day, due_day, credit_limit)
  values (v_house, 'Nubank Vinicius', 'Nubank', '4821', 'Mastercard', v_vini, 3, 10, 12000)
  returning id into v_nubank;

  insert into public.cards (house_id, name, institution, last_four, brand, owner_id, closing_day, due_day, credit_limit)
  values (v_house, 'Itau Larissa', 'Itau', '7390', 'Visa', v_lari, 8, 15, 9000)
  returning id into v_itau;

  -- ---------------------------------------------------------------------
  -- Lancamentos do mes corrente.
  -- ---------------------------------------------------------------------
  insert into public.transactions
    (house_id, card_id, member_id, date, invoice_month, description, merchant_original,
     amount, type, origin, status, category_id, visibility, created_by)
  values
    (v_house, v_nubank, v_vini, v_mes + 2,  v_mes, 'PG *99 RIDE',      'PG *99 RIDE',       32.90, 'expense', 'invoice', 'confirmed', c_transp,  'individual', v_vini),
    (v_house, v_nubank, v_vini, v_mes + 4,  v_mes, 'DL*99 RIDE',       'DL*99 RIDE',        18.40, 'expense', 'invoice', 'confirmed', c_transp,  'individual', v_vini),
    (v_house, v_nubank, v_vini, v_mes + 5,  v_mes, 'PAO DE ACUCAR',    'PAO DE ACUCAR 1234',412.77, 'expense', 'invoice', 'confirmed', c_alim,    'shared',     v_vini),
    (v_house, v_itau,   v_lari, v_mes + 6,  v_mes, 'ZE DELIVERY',      'ZE DELIVERY',        89.90, 'expense', 'invoice', 'confirmed', c_alim,    'shared',     v_lari),
    (v_house, v_nubank, v_vini, v_mes + 8,  v_mes, 'NETFLIX',          'NETFLIX.COM',        55.90, 'expense', 'invoice', 'confirmed', c_assin,   'shared',     v_vini),
    (v_house, v_nubank, v_vini, v_mes + 8,  v_mes, 'SPOTIFY',          'SPOTIFY',            34.90, 'expense', 'invoice', 'confirmed', c_assin,   'shared',     v_vini),
    (v_house, v_itau,   v_lari, v_mes + 10, v_mes, 'ALUGUEL',          'IMOBILIARIA XYZ',  2400.00, 'expense', 'manual',  'confirmed', c_moradia, 'shared',     v_lari),
    (v_house, v_itau,   v_lari, v_mes + 12, v_mes, 'CINEMA',           'CINEMARK',           76.00, 'expense', 'invoice', 'confirmed', c_lazer,   'shared',     v_lari),
    -- Estorno: a secao 12 exige que reduza o gasto, sem virar despesa nova.
    (v_house, v_nubank, v_vini, v_mes + 13, v_mes, 'ESTORNO ZE DELIVERY', 'ZE DELIVERY',     89.90, 'refund',  'invoice', 'confirmed', c_alim,    'shared',     v_vini),
    -- Pagamento da fatura: nao e gasto, so quita o cartao.
    (v_house, v_nubank, v_vini, v_mes + 9,  v_mes, 'PAGAMENTO RECEBIDO', null,             1500.00, 'payment', 'invoice', 'confirmed', null,      'shared',     v_vini),
    -- Receita: entra no card de receitas, nunca no total gasto.
    (v_house, null,     v_vini, v_mes,      v_mes, 'Salario',          null,              9800.00, 'income',  'manual',  'confirmed', null,      'individual', v_vini);

  -- Mes anterior, para haver comparacao no mapa de fluxo.
  insert into public.transactions
    (house_id, card_id, member_id, date, invoice_month, description, merchant_original,
     amount, type, origin, status, category_id, visibility, created_by)
  values
    (v_house, v_nubank, v_vini, v_ant + 5,  v_ant, 'PAO DE ACUCAR', 'PAO DE ACUCAR 1234', 380.15, 'expense', 'invoice', 'confirmed', c_alim,  'shared',     v_vini),
    (v_house, v_nubank, v_vini, v_ant + 8,  v_ant, 'NETFLIX',       'NETFLIX.COM',         49.90, 'expense', 'invoice', 'confirmed', c_assin, 'shared',     v_vini),
    (v_house, v_nubank, v_vini, v_ant + 8,  v_ant, 'SPOTIFY',       'SPOTIFY',             34.90, 'expense', 'invoice', 'confirmed', c_assin, 'shared',     v_vini),
    (v_house, v_itau,   v_lari, v_ant + 10, v_ant, 'ALUGUEL',       'IMOBILIARIA XYZ',   2400.00, 'expense', 'manual',  'confirmed', c_moradia,'shared',    v_lari),
    (v_house, v_nubank, v_vini, v_ant + 14, v_ant, 'PG *99 RIDE',   'PG *99 RIDE',         71.20, 'expense', 'invoice', 'confirmed', c_transp,'individual', v_vini);

  -- ---------------------------------------------------------------------
  -- Compra parcelada 3/10: mesma compra em meses distintos, que a deteccao
  -- de duplicidade NAO pode colapsar.
  -- ---------------------------------------------------------------------
  insert into public.transactions
    (house_id, card_id, member_id, date, invoice_month, description, merchant_original,
     amount, type, origin, status, category_id, visibility,
     installment_current, installment_total, installment_value, created_by)
  select
    v_house, v_nubank, v_vini,
    (v_mes + interval '1 month' * (i - 3))::date + 6,
    (v_mes + interval '1 month' * (i - 3))::date,
    'GELADEIRA BRASTEMP', 'MAGAZINE LUIZA',
    289.90, 'expense', 'invoice',
    case when i <= 3 then 'confirmed'::forecast_status else 'forecast'::forecast_status end,
    null, 'shared', i, 10, 289.90, v_vini
  from generate_series(1, 10) as i;

  -- ---------------------------------------------------------------------
  -- Recorrencias, orcamentos e metas
  -- ---------------------------------------------------------------------
  insert into public.recurrences
    (house_id, description, merchant, amount, category_id, card_id, owner_id,
     interval, next_date, expected_day, source, created_by)
  values
    (v_house, 'Netflix', 'NETFLIX.COM', 55.90, c_assin, v_nubank, v_vini, 'monthly', v_mes + 38, 8, 'detected', v_vini),
    (v_house, 'Spotify', 'SPOTIFY',     34.90, c_assin, v_nubank, v_vini, 'monthly', v_mes + 38, 8, 'detected', v_vini),
    (v_house, 'Aluguel', 'IMOBILIARIA XYZ', 2400.00, c_moradia, v_itau, v_lari, 'monthly', v_mes + 40, 10, 'manual', v_lari);

  insert into public.budgets (house_id, category_id, month, limit_amount, created_by)
  values
    (v_house, c_alim,   v_mes, 2000.00, v_vini),
    (v_house, c_transp, v_mes,  400.00, v_vini),
    (v_house, c_lazer,  v_mes,  500.00, v_lari);

  insert into public.goals
    (house_id, name, target_amount, target_date, monthly_contribution, owner_id, created_by)
  values
    (v_house, 'Viagem para Portugal', 18000.00, (v_mes + interval '10 months')::date, 1500.00, v_lari, v_lari),
    (v_house, 'Reserva de emergencia', 30000.00, null, 1000.00, v_vini, v_vini);

  insert into public.goal_deposits (house_id, goal_id, amount, date, member_id, created_by)
  select v_house, g.id, 1500.00, v_ant + 5, g.owner_id, g.owner_id
    from public.goals g where g.house_id = v_house;

  raise notice 'Seed pronto. Casa 50 criada com Vinicius (owner) e Larissa (admin). Senha: fluxo1234';
end;
$seed$;
