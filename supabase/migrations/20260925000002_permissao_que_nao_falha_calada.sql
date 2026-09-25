-- ===========================================================================
-- Verificacao de permissao que NAO falha calada com NULL
--
-- O DEFEITO, achado testando a chave de IA contra um usuario de fora da casa:
--
--     if not app.can_write(v_house) then raise ...; end if;
--
-- `app.can_write` e `app.can_admin` devolvem NULL - e nao `false` - para quem
-- nao e membro, porque `app.role_in` nao acha linha e `NULL in (...)` e NULL.
-- Em PL/pgSQL, `if not NULL` NAO ENTRA no if. A verificacao era pulada
-- justamente para quem ela existia para barrar.
--
-- Nas politicas de RLS isso nao acontece: la, NULL conta como "nao passa".
-- So dentro de funcao PL/pgSQL o NULL vira "segue em frente".
--
-- MEDIDO NO BANCO REAL, antes da correcao: um usuario autenticado de fora da
-- casa chamou `calendar_source_url` e recebeu o endereco privado da agenda
-- (116 caracteres). Explorar exigia saber o id da agenda - um UUID, que a
-- politica de leitura de `calendar_sources` nao entrega a quem e de fora -,
-- mas a trava que devia barrar estava aberta.
--
-- A CORRECAO e `is not true`, que trata NULL como recusa. O teste
-- `permissao-sql.test.ts` le todas as migracoes e falha se o padrao antigo
-- voltar.
--
-- As quatro funcoes da chave de IA sao redefinidas aqui tambem: a migracao
-- anterior foi aplicada com o mesmo defeito antes de o teste acha-lo.
-- ===========================================================================

create or replace function public.calendar_source_url(p_source_id uuid)
returns text language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_house uuid;
  v_url   text;
begin
  select house_id, url into v_house, v_url
    from public.calendar_sources
   where id = p_source_id;

  if v_house is null then
    raise exception 'Agenda nao encontrada' using errcode = 'P0002';
  end if;
  if app.can_write(v_house) is not true then
    raise exception 'Sem permissao para sincronizar esta agenda' using errcode = '42501';
  end if;

  return v_url;
end;
$fn$;

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
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
  update public.house_ai_settings
     set secret_id = null, key_hint = null, updated_by = auth.uid(), updated_at = now()
   where house_id = p_house;
end;
$fn$;

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
