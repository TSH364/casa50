-- Fluxo - Financas do Casal :: gasto "dos dois"
--
-- "Quem gastou" tinha duas respostas, uma por pessoa, e uma terceira
-- escondida: vazio. So que vazio quer dizer "ninguem marcou", e nao "foi dos
-- dois" - e o filtro por pessoa precisa distinguir as duas coisas. O jantar
-- dos dois tem de aparecer no filtro de cada um; o lancamento que ninguem
-- marcou segue o dono do cartao.
--
-- Uma coluna propria, e nao um valor especial em member_id: member_id e
-- chave estrangeira para profiles, e um id inventado para "os dois" ou
-- quebraria a chave, ou exigiria um perfil falso na casa.

alter table public.transactions
  add column is_joint boolean not null default false;

-- Dos dois E de uma pessoa ao mesmo tempo nao existe: o banco recusa, para
-- nenhuma tela ter de escolher qual das duas respostas vale.
alter table public.transactions
  add constraint transactions_joint_without_member
  check (not is_joint or member_id is null);

comment on column public.transactions.is_joint is
  'Gasto dos dois (ou de todos da casa): aparece no filtro de cada pessoa, com o valor cheio. Exige member_id nulo.';
