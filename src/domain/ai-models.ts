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

/**
 * O Jev, da TypeSafe, que classifica (secao 15).
 *
 * Nao e modelo de conversa: recebe uma situacao e perguntas de escolha, e
 * devolve a opcao escolhida COM a probabilidade de cada uma. E a
 * probabilidade que interessa aqui - e ela que decide se o palpite entra
 * sozinho, vai para a casa conferir, ou e descartado.
 *
 * Fixo, sem opcao na tela: e o unico modelo que fala a API de decisoes, e um
 * select com uma opcao so seria enfeite.
 */
export const JEV_MODEL = "typesafe/jev-1.13";

/**
 * O modelo da conversa: o roteador GRATUITO do OpenRouter.
 *
 * Um roteador, e nao um modelo fixo, porque o catalogo gratuito muda toda
 * semana - um `:free` que existe hoje pode sumir, e a conversa quebraria no
 * dia seguinte. O roteador escolhe, entre os gratuitos disponiveis, um que
 * saiba usar ferramentas.
 *
 * A casa escolheu o gratuito sabendo o custo: o provedor pode guardar e
 * treinar com o que recebe. Ver `allowDataCollection` em `lib/openrouter.ts`.
 * `OPENROUTER_CHAT_MODEL` troca, se um dia valer fixar um.
 */
export const DEFAULT_CHAT_MODEL = "openrouter/free";

/**
 * O modelo PAGO da conversa: o que responde o que o Jev julga complexo, os
 * pedidos de mudar dado, e o que o gratuito nao conseguiu.
 *
 * Gemini Flash, e nao o Claude da leitura de orcamento: a conversa manda
 * muito contexto por pergunta (retrato do mes, resultados de ferramenta), e
 * o Flash custa uma fracao por token lendo bem o suficiente. Ja conferido no
 * catalogo (e o "mais barato" da lista de orcamento). Vai com
 * `data_collection: deny`. `OPENROUTER_CHAT_PAID_MODEL` troca.
 */
export const DEFAULT_CHAT_PAID_MODEL = "google/gemini-3.6-flash";
