/**
 * Os modelos que a tela oferece para a leitura de orcamento (secao 15).
 *
 * UMA LISTA, e nao um campo de texto: nome de modelo digitado errado nao da
 * erro na hora de salvar - da 404 na primeira leitura, com o orcamento na mao.
 * Os dois foram conferidos no catalogo do OpenRouter em setembro/2026, e os
 * dois leem imagem.
 */
export const QUOTE_MODELS = [
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    // Curto de proposito: vai dentro de um select, que a 360px corta o texto
    // no meio da palavra. A explicacao longa fica abaixo do campo.
    note: "padrão",
  },
  {
    id: "google/gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    note: "mais barato",
  },
] as const;

export type QuoteModelId = (typeof QUOTE_MODELS)[number]["id"];

export const DEFAULT_QUOTE_MODEL: QuoteModelId = "anthropic/claude-sonnet-5";

export function isQuoteModel(value: unknown): value is QuoteModelId {
  return QUOTE_MODELS.some((m) => m.id === value);
}

/**
 * Formato da chave do OpenRouter - o mesmo que o banco confere em
 * `set_ai_key`. Conferido tambem na tela, para o erro aparecer antes de ir ao
 * servidor.
 */
export const OPENROUTER_KEY_RE = /^sk-or-[A-Za-z0-9_-]{16,200}$/;
