-- ===========================================================================
-- Proposta de subcategoria recusada pela casa
--
-- O app passa a PROPOR subcategorias a partir do comportamento: nos oito
-- meses reais, um estabelecimento aparece 14 vezes e nunca num fim de semana
-- (e almoco de trabalho), outro so aparece em sabado e domingo. A proposta
-- nasce do dado; a decisao e da casa.
--
-- Esta tabela guarda o "nao". Sem ela a mesma proposta voltaria a cada visita
-- a tela, porque o padrao no extrato continua la - recusar nao apaga o gasto.
-- Um app que reapresenta o que ja foi recusado ensina a ignorar o que ele diz,
-- e ai a proposta boa some junto com a ruim.
--
-- A chave e (categoria, tipo de proposta), e nao a lista de estabelecimentos:
-- "nao quero separar fim de semana em Alimentacao" continua valendo quando
-- aparecer uma padaria nova no mes seguinte. Recusa tem volta - a tela mostra
-- as recusadas e desfaz.
-- ===========================================================================

create table if not exists public.subcategory_dismissals (
  house_id       uuid not null references public.houses (id) on delete cascade,
  category_id    uuid not null references public.categories (id) on delete cascade,
  -- Chave do balde em src/domain/subcategories.ts: rotina | mercado | fim_de_semana.
  suggestion_key text not null check (btrim(suggestion_key) <> ''),
  dismissed_by   uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (house_id, category_id, suggestion_key)
);

alter table public.subcategory_dismissals enable row level security;

do $do$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public'
                    and tablename = 'subcategory_dismissals'
                    and policyname = 'subcategory_dismissals_select') then
    create policy subcategory_dismissals_select
      on public.subcategory_dismissals for select to authenticated
      using (app.is_member(house_id));
    create policy subcategory_dismissals_insert
      on public.subcategory_dismissals for insert to authenticated
      with check (app.can_write(house_id));
    create policy subcategory_dismissals_delete
      on public.subcategory_dismissals for delete to authenticated
      using (app.can_write(house_id));
  end if;
end;
$do$;

comment on table public.subcategory_dismissals is
  'Propostas de subcategoria que a casa recusou. Impede a mesma sugestao de voltar a cada visita; a tela permite desfazer.';
