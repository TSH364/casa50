-- Fluxo - Financas do Casal :: tarefas da casa, em quadro (estilo Trello)
--
-- Colunas que a casa cria (task_lists), tarefas dentro delas (tasks), e o
-- elo de uma tarefa com os lancamentos que ela gerou (task_transactions).
--
-- A tarefa pode ter um VALOR PREVISTO ("consertar o chuveiro, R$ 250") e,
-- quando for paga, os lancamentos reais do extrato ligados a ela: o quadro
-- mostra previsto x gasto. O gasto nao e copiado - e a soma dos lancamentos
-- ligados, lida na hora, para nunca divergir do extrato.
--
-- MESMA CASA POR CONSTRUCAO. Chaves compostas (id, house_id): uma tarefa so
-- aponta para coluna da propria casa, e um elo so liga tarefa e lancamento da
-- MESMA casa. Sem isso, quem pode escrever numa casa poderia pendurar um
-- lancamento de outra na sua tarefa - e ler o valor dele pela soma.

-- Alvo das chaves compostas. `id` ja e unico; o par so existe para a FK.
alter table public.transactions
  add constraint transactions_id_house_unique unique (id, house_id);

create table if not exists public.task_lists (
  id          uuid primary key default gen_random_uuid(),
  house_id    uuid not null references public.houses (id) on delete cascade,
  name        text not null check (btrim(name) <> '' and length(name) <= 60),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, house_id)
);
create index if not exists task_lists_by_house on public.task_lists (house_id, position);
create trigger task_lists_touch before update on public.task_lists
  for each row execute function app.touch_updated_at();

create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  house_id        uuid not null references public.houses (id) on delete cascade,
  list_id         uuid not null,
  title           text not null check (btrim(title) <> '' and length(title) <= 200),
  notes           text check (notes is null or length(notes) <= 4000),
  position        integer not null default 0,
  -- Quem faz: uma pessoa, os dois, ou ninguem definido. Mesma regra do
  -- lancamento: "os dois" e coluna propria, e exclui uma pessoa.
  member_id       uuid references public.profiles (id) on delete set null,
  is_joint        boolean not null default false,
  due_date        date,
  expected_amount numeric(14, 2) check (expected_amount is null or expected_amount >= 0),
  done            boolean not null default false,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, house_id),
  foreign key (list_id, house_id) references public.task_lists (id, house_id) on delete cascade,
  constraint tasks_joint_without_member check (not is_joint or member_id is null)
);
create index if not exists tasks_by_list on public.tasks (list_id, position);
create trigger tasks_touch before update on public.tasks
  for each row execute function app.touch_updated_at();

create table if not exists public.task_transactions (
  house_id        uuid not null references public.houses (id) on delete cascade,
  task_id         uuid not null,
  transaction_id  uuid not null,
  created_at      timestamptz not null default now(),
  primary key (task_id, transaction_id),
  foreign key (task_id, house_id) references public.tasks (id, house_id) on delete cascade,
  foreign key (transaction_id, house_id) references public.transactions (id, house_id) on delete cascade
);
create index if not exists task_transactions_by_transaction on public.task_transactions (transaction_id);

alter table public.task_lists        enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_transactions enable row level security;

-- Mesma regra das outras tabelas da casa: le quem e membro, grava quem pode
-- escrever. (Em politica de RLS, o NULL de quem e de fora ja conta como
-- recusa.)
do $do$
declare
  t text;
begin
  foreach t in array array['task_lists', 'tasks', 'task_transactions']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.is_member(house_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.can_write(house_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (app.can_write(house_id)) with check (app.can_write(house_id))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (app.can_write(house_id))',
      t || '_delete', t);
  end loop;
end;
$do$;

comment on table public.task_lists is 'Colunas do quadro de tarefas da casa, na ordem de position.';
comment on table public.tasks is 'Tarefas da casa. O gasto real e a soma dos lancamentos ligados em task_transactions.';
comment on table public.task_transactions is 'Liga uma tarefa aos lancamentos que ela gerou. Tarefa e lancamento sempre da mesma casa (FK composta).';
