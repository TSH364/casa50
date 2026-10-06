-- ===========================================================================
-- Como a compra da obra foi paga, e o que comprar primeiro
--
-- Quatro coisas que a tela de projeto nao sabia dizer, e que quem esta em obra
-- precisa saber:
--
--   1. COMO PAGOU. Cartao, boleto, pix e dinheiro se comportam de forma
--      diferente no resto do app, e nao e detalhe de cadastro: o que passa no
--      cartao ja chega sozinho pela fatura; o que sai por boleto ou pix nao
--      chega por lugar nenhum.
--   2. EM QUE MES SAI DO BOLSO. Boleto de obra se combina para o mes que vem.
--      A data da compra e a data em que o dinheiro sai sao datas diferentes, e
--      guardar so a primeira joga a despesa no mes errado.
--   3. QUAL LANCAMENTO E ESTE. `transaction_id` ja existia na compra; o que
--      faltava era o caminho de volta, para o lancamento que o app cria a
--      partir de uma compra nao poder nascer duas vezes.
--   4. O QUE COMPRAR PRIMEIRO. Uma lista de quinze itens sem ordem de
--      urgencia responde "o que falta", mas nao "o que agora".
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Prioridade
--
-- NUMERO, e nao texto, por um motivo so: ordena. `order by priority nulls
-- last` poe alta antes de media sem tabela de traducao no meio, e "alta" e
-- "media" em ordem alfabetica dariam a ordem errada. O nome de cada nivel mora
-- no dominio, onde se le em portugues.
--
-- Tres niveis e nao cinco: numa lista de obra, quem usa cinco niveis acaba
-- marcando tudo como 2 ou 4, e o campo deixa de separar o que importa.
-- ---------------------------------------------------------------------------
alter table public.project_items
  add column if not exists priority smallint
    check (priority is null or priority between 1 and 3);

comment on column public.project_items.priority is
  '1 = alta, 2 = media, 3 = baixa. Nulo = a casa ainda nao decidiu.';

-- ---------------------------------------------------------------------------
-- Forma de pagamento e mes em que o dinheiro sai
--
-- `invoice_month` e o MES DA DESPESA, e nao o mes da compra - o mesmo conceito
-- que rege `transactions.invoice_month` no app inteiro. Quando a compra passou
-- no cartao, ele vem do lancamento vinculado; quando saiu por boleto, quem
-- diz e a casa, porque so ela sabe para quando combinou.
-- ---------------------------------------------------------------------------
alter table public.project_purchases
  add column if not exists payment_method text
    check (payment_method is null
           or payment_method in ('card', 'boleto', 'pix', 'cash')),
  add column if not exists invoice_month date
    check (invoice_month is null or extract(day from invoice_month) = 1),
  -- Em quantas vezes. So o numero de parcelas: o valor de cada uma e `amount`
  -- dividido por ele, e guardar os dois abriria espaco para divergirem.
  --
  -- `amount` continua sendo a compra INTEIRA, e nao a parcela do mes. Uma
  -- compra de R$ 8.965 em 10x aparece na fatura como R$ 896,55; gravar isso
  -- deixaria o porcelanato da sala 10% comprado para sempre.
  add column if not exists installment_total smallint
    check (installment_total is null or installment_total > 1);

comment on column public.project_purchases.installment_total is
  'Numero de parcelas. Nulo = a vista. `amount` e sempre o total da compra.';
comment on column public.project_purchases.payment_method is
  'card, boleto, pix, cash. Nulo nas compras registradas antes deste campo existir.';
comment on column public.project_purchases.invoice_month is
  'Mes em que a despesa cai. Nulo = usar o mes da data da compra.';

-- ---------------------------------------------------------------------------
-- O lancamento que NASCEU de uma compra da obra
--
-- So existe para o que nao passa no cartao. O que passa no cartao ja chega
-- pela fatura, e criar um lancamento ali contaria a mesma despesa duas vezes -
-- por isso a compra no cartao APONTA para um lancamento que ja existe, e as
-- outras formas fazem nascer um.
--
-- O indice unico e a mesma trava da parcela do financiamento: sem ele, dois
-- toques no botao - ou duas abas abertas - criariam duas despesas de R$ 4.000,
-- e dinheiro duplicado num historico e pior que dinheiro faltando, porque o
-- que falta se percebe e o que sobra parece gasto.
--
-- `on delete set null` e nao `cascade`: apagar o registro da compra na tela da
-- obra nao desfaz o pagamento. O dinheiro saiu, e o extrato do mes continua
-- tendo de dizer isso.
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column if not exists project_purchase_id uuid
    references public.project_purchases (id) on delete set null;

comment on column public.transactions.project_purchase_id is
  'A compra de projeto que originou este lancamento (boleto, pix, dinheiro).';

create unique index if not exists transactions_um_lancamento_por_compra
  on public.transactions (project_purchase_id)
  where project_purchase_id is not null;
