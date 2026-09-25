import "server-only";

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
 *   3. MODELO POR VARIAVEL DE AMBIENTE. Modelo muda de nome e de preco a cada
 *      poucos meses; trocar nao deve exigir deploy de codigo.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Modelo padrao. Confirmado no catalogo do OpenRouter em setembro/2026.
 * Le imagem, e a leitura de um orcamento custa centavos.
 */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

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

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function openRouterModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
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

/** Uma pergunta, uma resposta em texto. */
export async function chatCompletion(
  messages: readonly ChatMessage[],
  options: { maxTokens?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const chave = process.env.OPENROUTER_API_KEY?.trim();
  if (!chave) {
    throw new OpenRouterError("A leitura com IA não está configurada.", 0);
  }
  const modelo = openRouterModel();
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
