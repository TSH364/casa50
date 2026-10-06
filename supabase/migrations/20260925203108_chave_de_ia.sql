-- ===========================================================================
-- A chave do OpenRouter, guardada pela casa
--
-- Antes, a chave so entrava por variavel de ambiente na Vercel - o que exige
-- acesso ao painel da hospedagem e um novo deploy a cada troca. Agora ela pode
-- ser colada na tela da Casa.
--
-- ONDE ELA MORA: no Vault do Supabase (`vault.secrets`), que guarda o segredo
-- CRIPTOGRAFADO. Numa coluna comum, a chave apareceria em texto no editor de
-- tabelas, em backup e em qualquer `select *` - e ela paga pelas chamadas.
--
-- QUEM LE O QUE:
--
--   - A tabela `house_ai_settings` guarda so o que nao e segredo: os quatro
--     ultimos caracteres (para a tela dizer QUAL chave esta salva), o modelo,
--     quem trocou e quando. Qualquer membro le.
--   - Salvar e apagar a chave: so dono e administrador, e so por funcao. Nao ha
--     politica de escrita na tabela; nem o dono escreve nela direto.
--   - Ler a chave em texto: `ai_key_for_house`, para quem pode escrever na
--     casa - que e quem usa a IA para ler orcamento e classificar.
--
-- O LIMITE DESTE DESENHO, dito com clareza: a funcao de leitura precisa ser
-- chamavel com a sessao do usuario, porque e com ela que o servidor do app
-- fala com o banco. Entao um membro logado que chame a funcao direto pela API
-- ve a chave. Os membros sao os donos da chave; o risco e o de uma sessao
-- roubada, e o remedio e o limite de gasto na propria chave, no OpenRouter.
-- A alternativa que fecha isso - variavel de ambiente na Vercel - continua
-- valendo, e VENCE a chave salva aqui quando as duas existem.
-- ===========================================================================

create table if not exists public.house_ai_settings (
  house_id    uuid primary key references public.houses (id) on delete cascade,
  -- O segredo em si fica no Vault; aqui, so o ponteiro para ele.
  secret_id   uuid,
  -- "…a1b2": o bastante para reconhecer a chave, pouco para usa-la.
  key_hint    text,
  -- Modelo da leitura de orcamento. Nulo = o padrao do app.
  quote_model text check (quote_model is null or quote_model ~ '^[a-z0-9._~-]+/[a-z0-9._:-]+$'),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.house_ai_settings enable row level security;

-- Leitura: membro. Nada aqui e segredo - o segredo esta no Vault.
drop policy if exists house_ai_settings_select on public.house_ai_settings;
create policy house_ai_settings_select on public.house_ai_settings
  for select to authenticated using (app.is_member(house_id));

-- Sem politica de insert/update/delete: escrita so pelas funcoes abaixo, que
-- conferem o papel e mexem no Vault junto. Uma escrita direta na tabela
-- deixaria o ponteiro e o segredo desencontrados.

-- ---------------------------------------------------------------------------
-- Salvar a chave
-- ---------------------------------------------------------------------------
create or replace function public.set_ai_key(p_house uuid, p_key text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_secret uuid;
  v_key    text := btrim(p_key);
  v_hint   text;
begin
  if app.can_admin(p_house) is not true then
    raise exception 'Só dono ou administrador da casa muda a chave.' using errcode = '42501';
  end if;

  -- Formato da chave do OpenRouter. Conferir aqui evita guardar, criptografado
  -- e caprichado, o texto errado que foi colado por engano.
  if v_key !~ '^sk-or-[A-Za-z0-9_-]{16,200}$' then
    raise exception 'Isto não parece uma chave do OpenRouter (começa com sk-or-).' using errcode = '22023';
  end if;

  v_hint := '…' || right(v_key, 4);

  select secret_id into v_secret from public.house_ai_settings where house_id = p_house;

  if v_secret is null then
    v_secret := vault.create_secret(
      v_key,
      'openrouter_' || p_house::text,
      'Chave do OpenRouter da casa ' || p_house::text
    );
  else
    perform vault.update_secret(v_secret, v_key);
  end if;

  insert into public.house_ai_settings (house_id, secret_id, key_hint, updated_by, updated_at)
  values (p_house, v_secret, v_hint, auth.uid(), now())
  on conflict (house_id) do update
    set secret_id = excluded.secret_id,
        key_hint = excluded.key_hint,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return v_hint;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Apagar a chave
-- ---------------------------------------------------------------------------
create or replace function public.clear_ai_key(p_house uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_secret uuid;
begin
  if app.can_admin(p_house) is not true then
    raise exception 'Só dono ou administrador da casa muda a chave.' using errcode = '42501';
  end if;

  select secret_id into v_secret from public.house_ai_settings where house_id = p_house;
  -- O segredo SAI do Vault, e nao so o ponteiro: apagar e apagar, e uma chave
  -- orfa criptografada continuaria sendo uma chave valida guardada.
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;

  update public.house_ai_settings
     set secret_id = null, key_hint = null, updated_by = auth.uid(), updated_at = now()
   where house_id = p_house;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Modelo da leitura de orcamento
-- ---------------------------------------------------------------------------
create or replace function public.set_ai_quote_model(p_house uuid, p_model text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
begin
  if app.can_admin(p_house) is not true then
    raise exception 'Só dono ou administrador da casa muda o modelo.' using errcode = '42501';
  end if;

  insert into public.house_ai_settings (house_id, quote_model, updated_by, updated_at)
  values (p_house, nullif(btrim(p_model), ''), auth.uid(), now())
  on conflict (house_id) do update
    set quote_model = excluded.quote_model,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Ler a chave, para o servidor do app usar
--
-- `can_write` e nao `can_admin`: quem usa a IA e quem registra cotacao e
-- classifica lancamento - membro comum incluido. Leitor (viewer) nao escreve
-- nada, entao nao precisa da chave.
-- ---------------------------------------------------------------------------
create or replace function public.ai_key_for_house(p_house uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_key text;
begin
  if app.can_write(p_house) is not true then
    return null;
  end if;

  select s.decrypted_secret into v_key
    from public.house_ai_settings a
    join vault.decrypted_secrets s on s.id = a.secret_id
   where a.house_id = p_house;

  return v_key;
end;
$fn$;

-- Funcao nova nasce executavel por PUBLIC no Postgres - inclusive por `anon`,
-- quem nao fez login. Tira de todo mundo e devolve so a quem entrou.
revoke all on function public.set_ai_key(uuid, text) from public, anon;
revoke all on function public.clear_ai_key(uuid) from public, anon;
revoke all on function public.set_ai_quote_model(uuid, text) from public, anon;
revoke all on function public.ai_key_for_house(uuid) from public, anon;

grant execute on function public.set_ai_key(uuid, text) to authenticated;
grant execute on function public.clear_ai_key(uuid) to authenticated;
grant execute on function public.set_ai_quote_model(uuid, text) to authenticated;
grant execute on function public.ai_key_for_house(uuid) to authenticated;
