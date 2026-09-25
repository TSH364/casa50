import "server-only";
import { DEFAULT_QUOTE_MODEL } from "@/domain/ai-models";

/**
 * Cliente do OpenRouter (secao 15).
 *
 * SO NO SERVIDOR, e o `server-only` acima faz o build falhar se alguem
 * importar isto de um componente de cliente. A chave paga pelas chamadas: no
 * navegador, qualquer pessoa que abrisse o codigo da pagina poderia gasta-la.
 *
 * TRES DECISOES, cada uma por um motivo medido ou documentado:
 *
 *   1. `data_collection: "deny"`. O OpenRouter encaminha para varios
 *      provedores, e alguns guardam o que recebem para treinar modelos. Com
 *      "deny", a chamada so vai para quem nao guarda. O que sai daqui e o
 *      orcamento de um fornecedor - nao e dado da casa -, mas continua sendo
 *      documento que ninguem autorizou virar material de treino.
 *
 *   2. SEM `response_format: json_schema`. Parece o jeito certo de pedir
 *      JSON, e quebra: ha registro publico de chamadas que morrem TODAS com
 *      404 quando o esquema de resposta e combinado com restricao de dados,
 *      porque o roteador filtra os provedores por cada exigencia e nao sobra
 *      nenhum. O JSON e pedido no texto e conferido na volta
 *      (`domain/quote-ai.ts`), o que funciona em qualquer modelo.
 *
 *   3. A CHAVE E O MODELO VEM DE QUEM CHAMA. Podem estar na variavel de
 *      ambiente ou na configuracao da casa (ver `lib/ai-config.ts`); este
 *      arquivo so fala com o OpenRouter e nao sabe de onde eles vieram.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Modelo padrao. Confirmado no catalogo do OpenRouter em setembro/2026.
 * Le imagem, e a leitura de um orcamento custa centavos.
 */
export const DEFAULT_MODEL: string = DEFAULT_QUOTE_MODEL;

/**
 * Tempo maximo da chamada. Leitura de imagem leva de 5 a 20 segundos; mais
 * que isso e provedor travado, e a pessoa esta olhando para um "lendo...".
 * Fica abaixo do limite da funcao na Vercel (ver `maxDuration` da pagina),
 * para o erro chegar como mensagem e nao como pagina quebrada.
 */
const TIMEOUT_MS = 45_000;

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user";
  content: string | ContentPart[];
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    /** Status HTTP, ou 0 quando a falha foi antes de haver resposta. */
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/**
 * O que dizer para cada falha, em portugues e com o que fazer.
 *
 * A mensagem do OpenRouter vem em ingles e fala de "credits" e "endpoints";
 * quem esta na loja com o orcamento na mao precisa saber se e caso de
 * preencher a mao ou de mexer na configuracao.
 */
function mensagemPara(status: number, modelo: string): string {
  if (status === 401) return "A chave do OpenRouter não foi aceita. Confira OPENROUTER_API_KEY.";
  if (status === 402) return "A conta do OpenRouter está sem créditos.";
  if (status === 404) {
    return `Nenhum provedor disponível para o modelo "${modelo}". Confira OPENROUTER_MODEL no catálogo do OpenRouter.`;
  }
  if (status === 429) return "Muitas leituras seguidas. Espere um minuto e tente de novo.";
  if (status >= 500) return "O OpenRouter está com problema agora. Tente de novo em instantes.";
  return "A leitura com IA falhou.";
}

export interface CallOptions {
  apiKey: string | null;
  model?: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

/** Uma pergunta, uma resposta em texto. */
export async function chatCompletion(
  messages: readonly ChatMessage[],
  options: CallOptions,
): Promise<string> {
  const chave = options.apiKey?.trim();
  if (!chave) {
    throw new OpenRouterError("A leitura com IA não está configurada.", 0);
  }
  const modelo = options.model?.trim() || DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);

  let resposta: Response;
  try {
    resposta = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        // Identificam o app no painel do OpenRouter, para a conta mostrar de
        // onde veio cada gasto. Nao carregam dado nenhum da casa.
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fluxo.app",
        "X-Title": "Fluxo",
      },
      body: JSON.stringify({
        model: modelo,
        messages,
        // Leitura de documento nao e escrita criativa: a mesma foto tem de dar
        // o mesmo numero nas duas vezes que alguem tentar.
        temperature: 0,
        max_tokens: options.maxTokens ?? 800,
        provider: { data_collection: "deny" },
      }),
      signal: controle.signal,
    });
  } catch (e) {
    const abortou = e instanceof Error && e.name === "AbortError";
    throw new OpenRouterError(
      abortou
        ? "A leitura com IA demorou demais. Tente de novo, ou preencha à mão."
        : "Não consegui falar com o OpenRouter.",
      0,
    );
  } finally {
    clearTimeout(relogio);
  }

  if (!resposta.ok) {
    // O corpo do erro vai para o log e nao para a tela: pode citar a conta.
    const corpo = await resposta.text().catch(() => "");
    console.error("[openrouter] falha", { status: resposta.status, modelo, corpo: corpo.slice(0, 300) });
    throw new OpenRouterError(mensagemPara(resposta.status, modelo), resposta.status);
  }

  const json = (await resposta.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
    error?: { message?: string; code?: number };
  } | null;

  // O OpenRouter as vezes responde 200 com o erro DENTRO do corpo, quando o
  // provedor falha depois de a chamada ter sido aceita.
  if (json?.error) {
    console.error("[openrouter] erro no corpo", { modelo, erro: json.error });
    throw new OpenRouterError(mensagemPara(json.error.code ?? 500, modelo), json.error.code ?? 500);
  }

  const conteudo = json?.choices?.[0]?.message?.content;
  if (typeof conteudo !== "string" || conteudo.trim() === "") {
    throw new OpenRouterError("A IA respondeu vazio.", 200);
  }
  return conteudo;
}

// ---------------------------------------------------------------------------
// A chave em si: vale, e quanto ja gastou
// ---------------------------------------------------------------------------

export interface KeyInfo {
  /** Gasto acumulado da chave, em dolar (a moeda dos creditos do OpenRouter). */
  usageUsd: number;
  /** Limite de gasto posto na chave, ou `null` se ela nao tem limite. */
  limitUsd: number | null;
}

/**
 * Pergunta ao OpenRouter se a chave vale, e quanto ela ja gastou.
 *
 * Serve a dois momentos da tela da Casa: ANTES de guardar - para nao
 * criptografar com capricho uma chave que o OpenRouter vai recusar - e ao
 * abrir a tela, para mostrar o gasto e se ha limite.
 *
 * `GET /api/v1/key` nao gasta credito.
 */
export async function checkKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyInfo> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), 10_000);
  let resposta: Response;
  try {
    resposta = await fetchImpl("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      signal: controle.signal,
    });
  } catch {
    throw new OpenRouterError("Não consegui falar com o OpenRouter para testar a chave.", 0);
  } finally {
    clearTimeout(relogio);
  }

  if (resposta.status === 401 || resposta.status === 403) {
    throw new OpenRouterError("O OpenRouter recusou esta chave. Confira se copiou inteira.", 401);
  }
  if (!resposta.ok) {
    throw new OpenRouterError(mensagemPara(resposta.status, ""), resposta.status);
  }

  const json = (await resposta.json().catch(() => null)) as {
    data?: { usage?: unknown; limit?: unknown };
  } | null;
  const usage = Number(json?.data?.usage ?? 0);
  const limit = json?.data?.limit;
  return {
    usageUsd: Number.isFinite(usage) ? usage : 0,
    limitUsd: typeof limit === "number" && Number.isFinite(limit) ? limit : null,
  };
}

// ---------------------------------------------------------------------------
// Decisoes: o Jev
// ---------------------------------------------------------------------------

/**
 * A API de decisoes do OpenRouter, que serve o Jev.
 *
 * E OUTRO ENDERECO, e outro formato: nada de mensagens; vai uma situacao em
 * texto (`state`) e perguntas tipadas, e volta, para cada pergunta, a opcao
 * escolhida e a probabilidade de cada opcao. Nao ha texto para interpretar -
 * o que volta ja e o dado.
 *
 * "alpha" esta no caminho: o formato pode mudar. Por isso a leitura da
 * resposta e defensiva, e toda falha vira "sem palpite" para quem chama -
 * nunca uma importacao que deixa de funcionar porque a IA mudou.
 *
 * SEM `provider.data_collection`, ao contrario do chat: o Jev tem um provedor
 * so (a propria TypeSafe), e a API de decisoes nao documenta o campo. Mandar
 * um campo que ela nao conhece e arriscar que TODAS as chamadas falhem.
 */
const DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

/**
 * Tempo maximo de uma decisao. MEDIDO no exemplo publico: 600 a 900 ms. Dez
 * segundos e provedor travado, e quem esta esperando e a revisao da fatura.
 */
const DECISION_TIMEOUT_MS = 10_000;

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** chave -> o que a opcao significa. A chave volta na resposta. */
  criteria: Record<string, string>;
}

export interface ChoiceAnswer {
  choice: string;
  /** chave -> probabilidade, 0 a 1. */
  probabilities: Record<string, number>;
  confidence: number;
}

export interface DecideOptions {
  apiKey: string | null;
  model: string;
  fetchImpl?: typeof fetch;
}

/**
 * Uma situacao, varias perguntas de escolha, uma chamada.
 *
 * Devolve so as respostas que vieram no formato esperado; pergunta cuja
 * resposta veio estranha simplesmente nao aparece no resultado.
 */
export async function decide(
  state: string,
  questions: Record<string, ChoiceQuestion>,
  options: DecideOptions,
): Promise<Record<string, ChoiceAnswer>> {
  const chave = options.apiKey?.trim();
  if (!chave) throw new OpenRouterError("A IA não está configurada.", 0);
  const fetchImpl = options.fetchImpl ?? fetch;

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), DECISION_TIMEOUT_MS);
  let resposta: Response;
  try {
    resposta = await fetchImpl(DECISIONS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fluxo.app",
        "X-Title": "Fluxo",
      },
      body: JSON.stringify({ model: options.model, state, questions }),
      signal: controle.signal,
    });
  } catch (e) {
    const abortou = e instanceof Error && e.name === "AbortError";
    throw new OpenRouterError(
      abortou ? "O Jev demorou demais para responder." : "Não consegui falar com o OpenRouter.",
      0,
    );
  } finally {
    clearTimeout(relogio);
  }

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    console.error("[openrouter] decisao falhou", {
      status: resposta.status,
      modelo: options.model,
      corpo: corpo.slice(0, 300),
    });
    throw new OpenRouterError(mensagemPara(resposta.status, options.model), resposta.status);
  }

  const json = (await resposta.json().catch(() => null)) as {
    answers?: Record<string, unknown>;
    error?: { code?: number } | string;
  } | null;

  // Como no chat: o erro pode vir DENTRO de uma resposta 200.
  if (!json || json.error) {
    const codigo = typeof json?.error === "object" ? (json.error.code ?? 500) : 500;
    console.error("[openrouter] decisao com erro no corpo", { modelo: options.model, erro: json?.error });
    throw new OpenRouterError(mensagemPara(codigo, options.model), codigo);
  }

  const resultado: Record<string, ChoiceAnswer> = {};
  for (const nome of Object.keys(questions)) {
    const lida = lerEscolha(json.answers?.[nome], questions[nome]!);
    if (lida) resultado[nome] = lida;
  }
  return resultado;
}

/**
 * Confere uma resposta de escolha antes de confiar nela.
 *
 * A escolha tem de ser uma das chaves que foram perguntadas - uma chave
 * inventada viraria, mais adiante, um id de categoria que nao existe - e as
 * probabilidades tem de ser numeros entre 0 e 1.
 */
function lerEscolha(bruto: unknown, pergunta: ChoiceQuestion): ChoiceAnswer | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as { choice?: unknown; probabilities?: unknown; confidence?: unknown };
  if (typeof r.choice !== "string" || !(r.choice in pergunta.criteria)) return null;

  const probabilities: Record<string, number> = {};
  if (r.probabilities && typeof r.probabilities === "object") {
    for (const [k, v] of Object.entries(r.probabilities as Record<string, unknown>)) {
      if (k in pergunta.criteria && typeof v === "number" && v >= 0 && v <= 1) {
        probabilities[k] = v;
      }
    }
  }
  // Sem a probabilidade da escolhida nao ha como decidir se ela entra: a
  // resposta vale como "nao sei".
  if (probabilities[r.choice] === undefined) return null;

  const confidence = typeof r.confidence === "number" ? r.confidence : 0;
  return { choice: r.choice, probabilities, confidence };
}
