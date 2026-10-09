-- ===========================================================================
-- Secretario: as funcoes que mexem no Vault junto com a conexao do Gmail.
-- Mesmo desenho do Meu Pluggy: sem politica de escrita em email_connections;
-- so estas funcoes gravam, e o segredo nunca volta ao navegador.
-- plpgsql, e nao sql: o corpo de uma funcao sql e conferido na criacao.
-- ===========================================================================

-- Salvar (ou trocar) o proprio Gmail. Chamada pelo retorno do Google.
create or replace function public.set_email_connection(p_house uuid, p_email text, p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_me     uuid := auth.uid();
  v_secret uuid;
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_token  text := btrim(coalesce(p_refresh_token, ''));
begin
  if v_me is null or app.can_write(p_house) is not true then
    raise exception 'Só quem participa da casa conecta o Gmail.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'Endereço de e-mail inválido.' using errcode = '22023';
  end if;
  if char_length(v_token) < 10 or char_length(v_token) > 2000 then
    raise exception 'O Google não devolveu a autorização.' using errcode = '22023';
  end if;

  select secret_id into v_secret
    from public.email_connections where house_id = p_house and member_id = v_me;
  if v_secret is null then
    v_secret := vault.create_secret(v_token, 'gmail_' || p_house::text || '_' || v_me::text, 'Refresh token do Gmail');
  else
    perform vault.update_secret(v_secret, v_token);
  end if;

  insert into public.email_connections (house_id, member_id, email_address, secret_id, last_error, updated_at)
  values (p_house, v_me, v_email, v_secret, null, now())
  on conflict (house_id, member_id) do update
    set email_address = excluded.email_address,
        secret_id = excluded.secret_id,
        last_error = null,
        updated_at = now();
end;
$fn$;

-- Desconectar o proprio Gmail: o token sai do Vault e os itens dele saem junto.
create or replace function public.clear_email_connection(p_house uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_secret uuid;
begin
  select secret_id into v_secret
    from public.email_connections where house_id = p_house and member_id = auth.uid();
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
  delete from public.email_connections where house_id = p_house and member_id = auth.uid();
end;
$fn$;

-- Os tokens da casa, para o servidor do app ler os e-mails.
create or replace function public.email_connection_secrets(p_house uuid)
returns table (id uuid, member_id uuid, email_address text, refresh_token text, last_sync_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
begin
  if app.can_write(p_house) is not true then
    return;
  end if;
  return query
    select c.id, c.member_id, c.email_address, s.decrypted_secret::text, c.last_sync_at
      from public.email_connections c
      join vault.decrypted_secrets s on s.id = c.secret_id
     where c.house_id = p_house;
end;
$fn$;

-- O resultado de uma leitura.
create or replace function public.mark_email_sync(p_connection uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_house uuid;
begin
  select house_id into v_house from public.email_connections where id = p_connection;
  if v_house is null or app.can_write(v_house) is not true then
    return;
  end if;
  update public.email_connections
     set last_sync_at = case when p_error is null then now() else last_sync_at end,
         last_error = left(p_error, 300),
         sync_started_at = null,
         updated_at = now()
   where id = p_connection;
end;
$fn$;
