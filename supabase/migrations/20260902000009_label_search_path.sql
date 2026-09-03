-- As duas funções de rótulo criadas na 0007 nasceram sem search_path fixo e
-- reabriram o aviso `function_search_path_mutable` do linter. São CASE puro,
-- sem acesso a tabela, mas fixar mantém a regra valendo para todo o schema.
alter function app.field_label(text)       set search_path = public, extensions, pg_temp;
alter function app.value_label(text, text) set search_path = public, extensions, pg_temp;
