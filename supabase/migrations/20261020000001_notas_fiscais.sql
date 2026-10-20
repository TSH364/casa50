-- ===========================================================================
-- Notas fiscais: a planilha que o Gemini da casa preenche a partir do Gmail,
-- lida pelo mesmo login do Google do secretario e ligada as compras.
--
-- A planilha de cada pessoa fica na conexao dela (email_connections). As
-- notas ficam em nf_notas, SEM o destinatario (nome, CPF, endereco): o app
-- nao precisa dele. transaction_id e a compra da fatura que a nota detalha.
-- ===========================================================================

alter table public.email_connections add column if not exists nf_sheet_id text
  check (nf_sheet_id is null or nf_sheet_id ~ '^[A-Za-z0-9_-]{20,100}$');
alter table public.email_connections add column if not exists nf_last_sync_at timestamptz;
alter table public.email_connections add column if not exists nf_last_error text;

create table if not exists public.nf_notas (
  id             uuid primary key default gen_random_uuid(),
  house_id       uuid not null references public.houses (id) on delete cascade,
  connection_id  uuid not null references public.email_connections (id) on delete cascade,
  chave          text not null check (char_length(chave) between 3 and 200),
  data           date not null,
  categoria      text check (char_length(categoria) <= 120),
  loja           text not null check (char_length(loja) <= 200),
  cnpj           text check (char_length(cnpj) <= 40),
  produto        text not null check (char_length(produto) <= 300),
  valor          numeric(12, 2) check (valor is null or valor > 0),
  quem           text check (char_length(quem) <= 60),
  pagamento      text check (char_length(pagamento) <= 80),
  numero         text check (char_length(numero) <= 80),
  pedido         text check (char_length(pedido) <= 80),
  chave_acesso   text check (chave_acesso is null or chave_acesso ~ '^\d{44}$'),
  link_email     text check (link_email is null or link_email like 'https://mail.google.com/%'),
  sem_compra     boolean not null default false,
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (house_id, chave)
);

create index if not exists nf_notas_por_compra on public.nf_notas (house_id, transaction_id);

alter table public.nf_notas enable row level security;

drop policy if exists nf_notas_select on public.nf_notas;
create policy nf_notas_select on public.nf_notas
  for select to authenticated using (app.is_member(house_id));
drop policy if exists nf_notas_insert on public.nf_notas;
create policy nf_notas_insert on public.nf_notas
  for insert to authenticated with check (
    app.can_write(house_id)
    and exists (select 1 from public.email_connections c where c.id = connection_id and c.house_id = nf_notas.house_id)
  );
drop policy if exists nf_notas_update on public.nf_notas;
create policy nf_notas_update on public.nf_notas
  for update to authenticated using (app.can_write(house_id)) with check (app.can_write(house_id));
drop policy if exists nf_notas_delete on public.nf_notas;
create policy nf_notas_delete on public.nf_notas
  for delete to authenticated using (app.can_write(house_id));

-- A planilha da propria conexao (email_connections nao tem politica de escrita).
create or replace function public.set_nf_sheet(p_house uuid, p_sheet_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_id text := nullif(btrim(coalesce(p_sheet_id, '')), '');
begin
  if auth.uid() is null or app.can_write(p_house) is not true then
    raise exception 'Só quem participa da casa liga a planilha.' using errcode = '42501';
  end if;
  if v_id is not null and v_id !~ '^[A-Za-z0-9_-]{20,100}$' then
    raise exception 'Isto não parece o link de uma planilha do Google.' using errcode = '22023';
  end if;
  update public.email_connections
     set nf_sheet_id = v_id, nf_last_error = null, nf_last_sync_at = null, updated_at = now()
   where house_id = p_house and member_id = auth.uid();
  if not found then
    raise exception 'Conecte o Google primeiro.' using errcode = '22023';
  end if;
end;
$fn$;

-- O resultado de uma leitura da planilha.
create or replace function public.mark_nf_sync(p_connection uuid, p_error text)
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
     set nf_last_sync_at = case when p_error is null then now() else nf_last_sync_at end,
         nf_last_error = left(p_error, 300)
   where id = p_connection;
end;
$fn$;

revoke all on function public.set_nf_sheet(uuid, text) from public, anon;
revoke all on function public.mark_nf_sync(uuid, text) from public, anon;
grant execute on function public.set_nf_sheet(uuid, text) to authenticated;
grant execute on function public.mark_nf_sync(uuid, text) to authenticated;
