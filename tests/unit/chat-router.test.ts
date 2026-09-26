import { describe, expect, it } from "vitest";
import { decideRoute, isActionRequest, isPdfRequest, pdfTarget, routeState, shouldFallBack } from "@/domain/chat-router";

/**
 * O roteador da conversa.
 *
 * O que guarda: o piso de acao pega os jeitos comuns de pedir mudanca (com
 * e sem acento) e nao pega pergunta de consulta; a rota so vai ao gratuito
 * com o Jev seguro; e so as falhas que o pago resolve disparam o fallback.
 */

describe("isActionRequest", () => {
  it.each([
    "Classifica isso como transporte",
    "esse dado é de transporte, pode categorizar",
    "Lança 50 reais no mercado ontem",
    "gastei 80 na farmácia",
    "paguei a luz hoje, 230",
    "muda o UBERRIDES para Uber",
    "me faz um gráfico dos últimos 6 meses",
    "grafico por categoria",
    "exporta em PDF",
  ])("ação: %s", (t) => expect(isActionRequest(t)).toBe(true));

  it.each([
    "Quanto gastamos em setembro?",
    "Quais os maiores gastos de março?",
    "Como estão os orçamentos?",
    "Quais parcelas ainda vão cair?",
  ])("consulta: %s", (t) => expect(isActionRequest(t)).toBe(false));
});

describe("decideRoute", () => {
  const jev = (choice: string, p: number) => ({ choice, probabilities: { [choice]: p } });

  it("simples e seguro: gratuito", () => {
    expect(decideRoute("Quanto gastamos?", jev("simples", 0.9))).toEqual({ tier: "gratuito", reason: "jev", probability: 0.9 });
  });

  it("simples mas em dúvida: pago", () => {
    expect(decideRoute("Quanto gastamos?", jev("simples", 0.55)).tier).toBe("pago");
  });

  it("complexa: pago", () => {
    expect(decideRoute("Por que subiu?", jev("complexa", 0.7)).tier).toBe("pago");
  });

  it("ação vence o Jev", () => {
    expect(decideRoute("classifica como lazer", jev("simples", 0.99))).toEqual({ tier: "pago", reason: "acao" });
  });

  it("sem Jev: pago", () => {
    expect(decideRoute("Quanto gastamos?", null)).toEqual({ tier: "pago", reason: "sem-jev" });
  });
});

describe("routeState e fallback", () => {
  it("o Jev lê a pergunta, e a resposta anterior só se for curta", () => {
    expect(routeState("e em agosto?", "Em setembro, R$ 10.")).toMatch(/Resposta anterior.*\nMensagem: e em agosto\?/);
    expect(routeState("e em agosto?", "x".repeat(500))).toBe("Mensagem: e em agosto?");
  });

  it("cota, privacidade e provedor fora: tenta no pago; chave recusada, não", () => {
    for (const s of [0, 404, 429, 500, 503]) expect(shouldFallBack(s)).toBe(true);
    for (const s of [400, 401, 403]) expect(shouldFallBack(s)).toBe(false);
  });
});

describe("PDF", () => {
  it.each(["exporta em PDF", "gera um pdf disso", "manda pra imprimir", "quero exportar"])("pedido: %s", (t) =>
    expect(isPdfRequest(t)).toBe(true),
  );
  it.each(["quanto gastamos?", "me mostra um gráfico", "o que falta classificar?"])("sem pedido: %s", (t) =>
    expect(isPdfRequest(t)).toBe(false),
  );
  it("com gráfico nesta resposta, é esta; sem, é a anterior", () => {
    expect(pdfTarget(true, true)).toBe("esta");
    expect(pdfTarget(false, true)).toBe("anterior");
    expect(pdfTarget(false, false)).toBe("esta");
  });
});
