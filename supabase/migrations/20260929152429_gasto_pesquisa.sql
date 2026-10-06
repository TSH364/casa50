-- Fluxo - Financas do Casal :: o gasto da pesquisa de compra
--
-- A Conversa ganhou a pesquisa de compra (busca na web pelo OpenRouter). Ela
-- e uma chamada separada, cobrada a parte (modelo + resultados da busca), e
-- entra no registro de gasto de IA com nome proprio, para a tela da chave
-- mostrar quanto a pesquisa custou.

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in ('orcamento', 'jev', 'conversa_gratuita', 'conversa_paga', 'insights', 'pesquisa'));
