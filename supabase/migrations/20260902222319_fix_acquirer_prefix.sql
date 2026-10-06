-- ===========================================================================
-- Fluxo :: 0006 corrigir o prefixo de adquirente
--
-- Bug encontrado pelos testes do importador, presente desde a 0001.
--
-- A regex era:
--   '^\s*(PG|DL|PAG|PGTO|...)\s*\*?\s*'
--
-- Todo o separador era opcional (`\s*\*?\s*` casa com string vazia), então
-- "PAG" casava com o começo de "PAGUE MENOS" e a loja virava "UE MENOS".
-- O mesmo valia para "PP" em "PPTO", "EC" em "ECONOMIA" e assim por diante.
--
-- Agora o separador é obrigatório: "*" (com ou sem espaços) ou pelo menos um
-- espaço. "PG *99 RIDE" e "DL*99 RIDE" continuam virando "99 RIDE";
-- "PAGUE MENOS" fica intacto.
--
-- A mesma correção existe em src/importers/detect.ts, e os dois lados são
-- cobertos pelos mesmos exemplos em tests/unit/importers.test.ts.
-- ===========================================================================

create or replace function app.normalize_merchant(raw text)
returns text language sql immutable
set search_path = public, extensions, pg_temp as $fn$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          upper(unaccent(coalesce(raw, ''))),
          '^\s*(PG|DL|PAG|PGTO|COMPRA|CB|EC|MP|PP|IFD|APL)(\s*\*\s*|\s+)', ''
        ),
        '\s*-?\s*(PARCELA\s*)?\d{1,2}\s*/\s*\d{1,2}\s*$', ''
      ),
      '[^A-Z0-9]+', ' ', 'g'
    ),
  '');
$fn$;

-- Recalcula o que já estava gravado com a normalização errada.
-- O sinalizador de auditoria evita que uma correção técnica apareça no
-- histórico do casal como se alguém tivesse editado cada lançamento.
do $do$
declare
  v_count integer;
begin
  perform set_config('app.skip_audit', 'on', true);

  update public.transactions
     set merchant_normalized = app.trim_merchant(
           coalesce(merchant_original, description))
   where merchant_normalized is distinct from app.trim_merchant(
           coalesce(merchant_original, description));
  get diagnostics v_count = row_count;

  update public.learned_rules
     set normalized_pattern = app.trim_merchant(pattern)
   where normalized_pattern is distinct from app.trim_merchant(pattern);

  perform set_config('app.skip_audit', 'off', true);
  raise notice 'Lancamentos renormalizados: %', v_count;
end;
$do$;
