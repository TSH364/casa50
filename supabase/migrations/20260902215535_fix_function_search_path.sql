-- ===========================================================================
-- Fluxo :: 0005 fixar search_path nas funcoes restantes
--
-- Fecha os avisos `function_search_path_mutable` do linter do Supabase.
--
-- Sem search_path fixo, a funcao resolve nomes pelo caminho de quem a chama.
-- Em funcao SECURITY DEFINER isso permite sequestrar uma chamada criando um
-- objeto homonimo num schema anterior no caminho. Nas SECURITY INVOKER aqui o
-- risco e menor, mas fixar e barato e elimina a classe inteira.
--
-- Sobra um aviso conhecido e aceito: `public.accept_house_invite` e
-- SECURITY DEFINER chamavel por usuario logado. E intencional - um convidado
-- ainda nao e membro, entao nao passa por nenhuma policy de house_members. A
-- funcao so casa o convite com o e-mail autenticado de quem chama, portanto
-- nao permite entrar numa casa arbitraria.
-- ===========================================================================

alter function app.touch_updated_at() set search_path = public, extensions, pg_temp;
alter function app.can_write(uuid)    set search_path = public, extensions, pg_temp;
alter function app.can_admin(uuid)    set search_path = public, extensions, pg_temp;
alter function app.money_br(numeric)  set search_path = public, extensions, pg_temp;
alter function app.describe_diff(text, jsonb, jsonb) set search_path = public, extensions, pg_temp;
