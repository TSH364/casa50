-- Fluxo - Financas do Casal :: o gasto da voz da Conversa
--
-- A Conversa passou a falar com voz neural (texto para fala pelo OpenRouter,
-- rota /api/voz). Cada fala e uma chamada, e entra no registro de gasto de IA
-- com nome proprio.

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in ('orcamento', 'jev', 'conversa_gratuita', 'conversa_paga', 'insights', 'pesquisa', 'voz'));
