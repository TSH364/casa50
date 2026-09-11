-- ===========================================================================
-- Convite pendente visivel para quem foi convidado (secao 4)
--
-- O bug: um convite pendente e uma linha de house_members com user_id NULL e
-- invite_email preenchido. A policy house_members_select exige
--
--   user_id = auth.uid()  OR  app.is_member(house_id)
--
-- e nenhuma das duas alcanca essa linha: user_id e NULL, e quem foi convidado
-- ainda nao e membro ativo. Ou seja, a pessoa convidada nao conseguia ver o
-- proprio convite - `listPendingInvitesForMe` voltava sempre vazio, e o
-- convite era intransitavel. Quem chegava criava outra casa e ficava sozinha
-- nela.
--
-- A correcao segue a mesma decisao ja tomada para `accept_house_invite`: um
-- RPC SECURITY DEFINER, que casa o convite pelo e-mail autenticado do proprio
-- usuario, em vez de afrouxar a policy. Afrouxar teria dois custos: exporia
-- linhas de house_members de casas alheias a quem descobrisse um e-mail
-- convidado, e exigiria abrir `houses` tambem, so para ler o nome.
-- ===========================================================================

create or replace function public.my_pending_invites()
returns table (house_id uuid, house_name text)
language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select m.house_id, h.name
    from public.house_members m
    join public.houses h on h.id = m.house_id
   where m.status = 'invited'
     and m.user_id is null
     and lower(m.invite_email) = lower(
           (select u.email from auth.users u where u.id = auth.uid())
         )
   order by m.invited_at;
$fn$;

revoke all on function public.my_pending_invites() from public, anon;
grant execute on function public.my_pending_invites() to authenticated;
