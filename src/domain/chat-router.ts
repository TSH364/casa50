/**
 * Qual modelo responde cada pergunta da conversa (secao 16).
 *
 * A casa pediu um motor: o Jev olha a pergunta e manda a simples para o
 * modelo GRATUITO e a complexa para o PAGO. Os dois tem custo diferente, e
 * nao so em dinheiro:
 *
 *   gratuito - custo zero, mas o provedor pode treinar com a conversa, ha
 *              cota de 50 chamadas/dia, e o modelo muda de uma vez para outra;
 *   pago     - centavos, provedor que nao guarda, e o mesmo modelo sempre.
 *
 * UM PISO QUE O JEV NAO DERRUBA: pedido de mudar dado (classificar, lancar)
 * ou de grafico vai ao pago mesmo que o Jev ache simples. E onde um
 * mal-entendido custa mais - uma proposta errada, um grafico do periodo
 * errado -, e onde modelo gratuito mais erra.
 *
 * Puro: monta a pergunta ao Jev e le a resposta. Quem chama e
 * `actions/chat.ts`.
 */

export type Tier = "gratuito" | "pago";

export interface Route {
  tier: Tier;
  /** Por que: o Jev decidiu, o piso de acao obrigou, ou o Jev nao respondeu. */
  reason: "jev" | "acao" | "sem-jev";
  /** Certeza do Jev em "simples", quando ele respondeu. */
  probability?: number;
}

/** A partir daqui o Jev manda para o gratuito. Na duvida, o pago. */
export const MIN_SIMPLES = 0.6;

export const ROUTE_QUESTION = {
  type: "choice" as const,
  instructions:
    "Um assistente financeiro de uma casa recebeu esta mensagem. Ela é simples de responder, ou complexa?",
  criteria: {
    simples:
      "Pergunta direta sobre um número ou uma lista: quanto gastou num mês, quais os maiores gastos, quanto falta no orçamento. Uma consulta resolve.",
    complexa:
      "Exige raciocínio: comparar períodos, explicar uma mudança, analisar tendência, juntar várias consultas, pergunta ambígua ou que depende da conversa anterior.",
  },
};

/**
 * Pedido de acao: mudar dado ou desenhar.
 *
 * Por palavra, e nao pelo Jev, de proposito: e a trava de seguranca, e trava
 * nao pode depender de um palpite. Falso positivo custa centavos (vai ao
 * pago sem precisar); falso negativo custa um dado errado.
 */
const ACAO =
  /\b(classifi\w*|categoriz\w*|recategoriz\w*|lan[cç]\w*|registr\w*|gastei|paguei|comprei|coloc\w*|mud\w*|troc\w*|marc\w*|corrig\w*|apag\w*|exclu\w*|grafico|gr[aá]fico\w*|pdf|export\w*|desenh\w*|plot\w*)\b/i;

export function isActionRequest(text: string): boolean {
  return ACAO.test(text.normalize("NFC"));
}

/** O que o Jev le: so a pergunta nova, e a ultima resposta se ela for curta. */
export function routeState(question: string, previousAnswer: string | null): string {
  const partes = [`Mensagem: ${question.slice(0, 600)}`];
  if (previousAnswer && previousAnswer.length < 400) {
    partes.unshift(`Resposta anterior do assistente: ${previousAnswer}`);
  }
  return partes.join("\n");
}

/**
 * A rota, a partir da resposta do Jev (ou da falta dela).
 *
 * Sem Jev, o pago: errar uma pergunta complexa custa mais que os centavos
 * de mandar uma simples para o modelo melhor.
 */
export function decideRoute(
  question: string,
  jev: { choice: string; probabilities: Record<string, number> } | null,
): Route {
  if (isActionRequest(question)) return { tier: "pago", reason: "acao" };
  if (!jev) return { tier: "pago", reason: "sem-jev" };
  const simples = jev.probabilities.simples ?? (jev.choice === "simples" ? 1 : 0);
  return {
    tier: jev.choice === "simples" && simples >= MIN_SIMPLES ? "gratuito" : "pago",
    reason: "jev",
    probability: simples,
  };
}

/** Falhas do gratuito que o pago resolve: cota, privacidade, provedor fora. */
export function shouldFallBack(status: number): boolean {
  return status === 0 || status === 402 || status === 404 || status === 408 || status === 429 || status >= 500;
}
