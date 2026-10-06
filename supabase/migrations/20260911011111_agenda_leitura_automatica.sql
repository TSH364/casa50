-- ===========================================================================
-- Leitura automatica da agenda: marca de sincronizacao
--
-- Ate aqui a sincronizacao apagava todos os eventos da agenda e regravava. Com
-- alguem olhando a tela e apertando o botao, o risco de parar no meio era
-- visivel e recuperavel. Passando a rodar sozinha, no fim da resposta de uma
-- pagina, ninguem esta olhando - e uma execucao interrompida entre o DELETE e o
-- INSERT deixaria a casa sem compromisso nenhum, sem aviso.
--
-- Com esta coluna a ordem se inverte: grava por cima (o indice unico de
-- (source_id, uid, starts_on) garante uma linha por ocorrencia), carimba a
-- rodada, e so entao apaga o que ficou com carimbo antigo. Interromper no meio
-- passa a deixar evento velho sobrando, que a proxima leitura limpa - em vez
-- de deixar a agenda vazia.
-- ===========================================================================

alter table public.calendar_events
  add column if not exists synced_at timestamptz not null default now();

-- A limpeza e sempre "desta agenda, o que nao foi carimbado nesta rodada".
create index if not exists calendar_events_sync
  on public.calendar_events (source_id, synced_at);

comment on column public.calendar_events.synced_at is
  'Carimbo da rodada de sincronizacao que gravou a linha. Linha com carimbo anterior ao da ultima rodada e sobra e e apagada.';
