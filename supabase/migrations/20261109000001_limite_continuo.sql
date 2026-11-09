-- ===========================================================================
-- Limite de gasto continuo.
--
-- O limite de uma categoria vale do mes em que foi definido em diante, ate
-- ser mudado: o app le, para cada categoria, a linha mais recente ate o mes
-- (ver `listBudgets`). Mudar dezembro continua sem mexer em novembro.
--
-- Tirar o limite grava ZERO no mes: "sem limite daqui em diante". Apagar a
-- linha nao bastaria - o limite de um mes anterior voltaria a valer.
-- ===========================================================================

alter table public.budgets drop constraint if exists budgets_limit_amount_check;
alter table public.budgets
  add constraint budgets_limit_amount_check check (limit_amount >= 0);
