import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/domain/types";
import type { TurnMessage, TurnOptions, TurnResult } from "@/lib/openrouter";

/**
 * A pergunta inteira: casa conferida, retrato no prompt, ferramentas
 * executadas no servidor, e a resposta.
 *
 * O modelo e um roteiro: cada teste diz o que ele "responde" a cada rodada.
 * O que guarda: nada sai sem casa; sem chave, nada sai; os numeros das
 * ferramentas sao os do dominio (os mesmos das telas); o que vai ao modelo
 * nao leva e-mail nem final de cartao; e o laco termina.
 */

const VINI = "11111111-1111-4111-8111-111111111111";
const LARI = "22222222-2222-4222-8222-222222222222";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  seq += 1;
  return {
    id: `t${seq}`, houseId: "casa-1", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: "2026-09-10", invoiceMonth: "2026-09", description: "x", merchantOriginal: null,
    merchantNormalized: null, merchantAlias: null, amount: 100, currency: "BRL", originalAmount: null,
    originalCurrency: null, type: "expense", origin: "invoice", status: "confirmed", categoryId: "ali",
    subcategoryId: null, note: "anotação privada", receiptUrl: null, visibility: "shared", splitType: "none",
    splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null, calendarEventId: null,
    eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null, createdAt: "", updatedAt: "",
    ...p,
  };
}

const LANCAMENTOS = [
  tx({ description: "IFOOD", merchantOriginal: "IFOOD", amount: 80, memberId: VINI }),
  tx({ description: "IFOOD", merchantOriginal: "IFOOD", amount: 40, memberId: LARI }),
  tx({ description: "POSTO", merchantOriginal: "POSTO SHELL", amount: 200, categoryId: "tra", memberId: VINI }),
  tx({ description: "PADARIA", merchantOriginal: "PADARIA", amount: 30, invoiceMonth: "2026-08", date: "2026-08-10" }),
];

const estado = {
  casa: true,
  chave: "sk-or-da-casa" as string | null,
  roteiro: [] as TurnResult[],
  /** O que o Jev responde sobre a rota; `null` = o Jev falha. */
  rota: { choice: "simples", p: 0.9 } as { choice: string; p: number } | null,
  /** Status com que o modelo gratuito falha, se falhar. */
  gratuitoFalha: null as number | null,
  estados: [] as string[],
  chamadas: [] as { messages: TurnMessage[]; options: TurnOptions }[],
};

vi.mock("server-only", () => ({}));
vi.mock("@/actions/shared", () => ({
  requireHouseId: async () => {
    if (!estado.casa) throw new Error("Nenhuma casa ativa.");
    return "casa-1";
  },
}));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => estado.chave }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// A conversa so le por ferramentas (mockadas abaixo); o cliente do banco so
// e usado por `applyProposal`, testado em chat-proposals.test.ts.
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => null,
  createClient: async () => ({}),
}));
vi.mock("@/lib/houses", () => ({
  getActiveHouse: async () => ({ active: { id: "casa-1", name: "Casa 50" } }),
  listMembers: async () => [
    { userId: VINI, fullName: "Vinicius Roselli", email: "vini@exemplo.com", role: "owner" },
    { userId: LARI, fullName: "Larissa Souza", email: "lari@exemplo.com", role: "member" },
  ],
}));
vi.mock("@/lib/house-view", () => ({
  houseView: async () => ({
    categories: [
      { id: "ali", houseId: "casa-1", name: "Alimentacao", color: "#f00", icon: null, parentId: null, isActive: true, excludedFromTotals: false },
      { id: "tra", houseId: "casa-1", name: "Transporte", color: "#00f", icon: null, parentId: null, isActive: true, excludedFromTotals: false },
    ],
    excluded: [],
    excludeCategoryIds: [],
    showingAll: false,
  }),
}));
vi.mock("@/data/queries", () => ({
  listMonthsWithData: async () => ["2026-09", "2026-08"],
  listTransactions: async (_h: string, f: { month?: string; fromMonth?: string; toMonth?: string; memberId?: string | null }) =>
    LANCAMENTOS.filter((t) =>
      (f.month ? t.invoiceMonth === f.month : true) &&
      (f.fromMonth ? t.invoiceMonth >= f.fromMonth : true) &&
      (f.toMonth ? t.invoiceMonth <= f.toMonth : true) &&
      (f.memberId ? t.memberId === f.memberId || t.isJoint : true),
    ),
  listBudgets: async () => [],
  listGoals: async () => ({ goals: [], deposits: [] }),
  listProjects: async () => [],
  listProjectItems: async () => [],
}));
vi.mock("@/lib/openrouter", async () => {
  class OpenRouterError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  }
  return {
    OpenRouterError,
    decide: async (state: string) => {
      estado.estados.push(state);
      if (!estado.rota) throw new OpenRouterError("sem Jev", 500);
      return { complexidade: { choice: estado.rota.choice, probabilities: { [estado.rota.choice]: estado.rota.p }, confidence: estado.rota.p } };
    },
    chatTurn: async (messages: TurnMessage[], options: TurnOptions) => {
      estado.chamadas.push({ messages: structuredClone(messages), options });
      if (estado.gratuitoFalha && options.model === "openrouter/free") {
        throw new OpenRouterError("Acabou a cota dos modelos gratuitos por agora.", estado.gratuitoFalha);
      }
      const proxima = estado.roteiro.shift();
      if (!proxima) throw new OpenRouterError("Acabou a cota dos modelos gratuitos por agora.", 429);
      return proxima;
    },
  };
});

const { askHouse } = await import("@/actions/chat");

const pede = (name: string, args: Record<string, unknown>, id = "c1"): TurnResult => ({
  content: null,
  toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  servedBy: "modelo/gratis:free",
});
const responde = (content: string): TurnResult => ({ content, toolCalls: [], servedBy: "modelo/gratis:free" });
const PERGUNTA = { messages: [{ role: "user" as const, content: "Quanto a Larissa gastou com alimentação?" }] };

describe("askHouse", () => {
  beforeEach(() => {
    estado.casa = true;
    estado.chave = "sk-or-da-casa";
    estado.roteiro = [];
    estado.chamadas = [];
    estado.rota = { choice: "simples", p: 0.9 };
    estado.gratuitoFalha = null;
    estado.estados = [];
  });

  it("sem casa, recusa antes de chamar a IA", async () => {
    estado.casa = false;
    await expect(askHouse(PERGUNTA)).rejects.toThrow();
    expect(estado.chamadas).toHaveLength(0);
  });

  it("sem chave, diz onde pôr, e nada sai", async () => {
    estado.chave = null;
    expect(await askHouse(PERGUNTA)).toMatchObject({ configured: false });
    expect(estado.chamadas).toHaveLength(0);
  });

  it("pergunta simples: responde com o retrato, numa chamada só", async () => {
    estado.roteiro = [responde("Em setembro, R$ 320,00.")];
    const r = await askHouse(PERGUNTA);
    expect(r).toMatchObject({ answer: "Em setembro, R$ 320,00.", consulted: [], model: "modelo/gratis:free" });
    const sistema = estado.chamadas[0]!.messages[0]!;
    // O retrato ja traz o total do mes, igual ao do Inicio.
    expect(sistema.content).toMatch(/Gasto: R\$\s?320,00 em 3 lançamentos/);
    expect(estado.chamadas[0]!.options).toMatchObject({ allowDataCollection: true, model: "openrouter/free" });
  });

  it("executa a ferramenta pedida, devolve o resultado e responde", async () => {
    estado.roteiro = [
      pede("resumo_do_mes", { mes: "2026-09", pessoa: "Lari" }),
      responde("A Larissa gastou R$ 40,00."),
    ];
    const r = await askHouse(PERGUNTA);
    expect(r).toMatchObject({ answer: "A Larissa gastou R$ 40,00.", consulted: ["resumo do mês"] });

    const segunda = estado.chamadas[1]!.messages;
    const resultado = segunda.find((m) => m.role === "tool")!;
    expect(resultado).toMatchObject({ tool_call_id: "c1" });
    expect(resultado.content).toMatch(/Larissa/);
    expect(resultado.content).toMatch(/Gasto: R\$\s?40,00 em 1 lançamentos/);
  });

  it("buscar lançamentos: soma e lista, maiores primeiro", async () => {
    estado.roteiro = [pede("buscar_lancamentos", { de: "2026-09", texto: "ifood" }), responde("ok")];
    await askHouse(PERGUNTA);
    const saida = estado.chamadas[1]!.messages.find((m) => m.role === "tool")!.content;
    expect(saida).toMatch(/2 encontrados/);
    expect(saida).toMatch(/Soma de todos os encontrados: R\$\s?120,00/);
    expect(saida.indexOf("80,00")).toBeLessThan(saida.indexOf("40,00"));
  });

  it("argumento ruim vira frase para o modelo corrigir, e a conversa segue", async () => {
    estado.roteiro = [
      pede("resumo_do_mes", { pessoa: "Pedro" }),
      pede("ferramenta_inventada", {}, "c2"),
      responde("Não achei o Pedro."),
    ];
    const r = await askHouse(PERGUNTA);
    expect(r.answer).toBe("Não achei o Pedro.");
    const saidas = estado.chamadas[2]!.messages.filter((m) => m.role === "tool").map((m) => m.content);
    expect(saidas[0]).toMatch(/Não achei a pessoa "Pedro"/);
    expect(saidas[1]).toMatch(/Ferramenta desconhecida/);
  });

  it("o laço termina: a última rodada vai sem ferramentas", async () => {
    estado.roteiro = [
      pede("parcelas_futuras", {}, "a"),
      pede("parcelas_futuras", {}, "b"),
      pede("parcelas_futuras", {}, "c"),
      pede("parcelas_futuras", {}, "d"),
      responde("Fechei com o que tinha."),
    ];
    const r = await askHouse(PERGUNTA);
    expect(r.answer).toBe("Fechei com o que tinha.");
    expect(estado.chamadas).toHaveLength(5);
    expect(estado.chamadas[4]!.options.tools).toEqual([]);
  });

  it("o que vai ao modelo não leva e-mail, final de cartão nem anotação", async () => {
    estado.roteiro = [pede("buscar_lancamentos", { de: "2026-08", ate: "2026-09" }), responde("ok")];
    await askHouse(PERGUNTA);
    const tudo = JSON.stringify(estado.chamadas.map((c) => c.messages));
    expect(tudo).not.toMatch(/@exemplo\.com/);
    expect(tudo).not.toMatch(/anotação privada/);
    // O nome que a importacao da ao cartao ("Cartao 6869") carrega o final.
    expect(tudo).not.toMatch(/6869/);
    expect(tudo).not.toMatch(/sk-or/);
  });

  it("falha do OpenRouter chega como a frase dele", async () => {
    const r = await askHouse(PERGUNTA);
    expect(r.error).toMatch(/cota dos modelos gratuitos/);
  });
});

describe("askHouse — qual modelo responde", () => {
  beforeEach(() => {
    estado.casa = true;
    estado.chave = "sk-or-da-casa";
    estado.roteiro = [responde("ok"), responde("ok")];
    estado.chamadas = [];
    estado.rota = { choice: "simples", p: 0.9 };
    estado.gratuitoFalha = null;
    estado.estados = [];
  });

  const perguntar = (content: string) => askHouse({ messages: [{ role: "user", content }] });

  it("o Jev acha simples: gratuito, aceitando provedor que guarda", async () => {
    const r = await perguntar("Quanto gastamos em setembro?");
    expect(r).toMatchObject({ tier: "gratuito", route: "jev" });
    expect(estado.chamadas[0]!.options).toMatchObject({ model: "openrouter/free", allowDataCollection: true });
    // O Jev leu so a pergunta.
    expect(estado.estados[0]).toMatch(/Quanto gastamos em setembro/);
    expect(estado.estados[0]).not.toMatch(/RETRATO|Gasto:/);
  });

  it("o Jev acha complexa: pago, com provedor que não guarda", async () => {
    estado.rota = { choice: "complexa", p: 0.8 };
    const r = await perguntar("Por que gastamos mais em agosto que em julho?");
    expect(r).toMatchObject({ tier: "pago", route: "jev" });
    expect(estado.chamadas[0]!.options).toMatchObject({ model: "google/gemini-3.6-flash", allowDataCollection: false });
  });

  it("pedido de mudar dado vai ao pago mesmo que o Jev ache simples", async () => {
    const r = await perguntar("Classifica o UBERRIDES como transporte");
    expect(r).toMatchObject({ tier: "pago", route: "acao" });
  });

  it("sem Jev, o pago", async () => {
    estado.rota = null;
    expect(await perguntar("Quanto gastamos?")).toMatchObject({ tier: "pago", route: "sem-jev" });
  });

  it("gratuito sem cota: o pago assume, e a resposta diz", async () => {
    estado.gratuitoFalha = 429;
    const r = await perguntar("Quanto gastamos em setembro?");
    expect(r).toMatchObject({ answer: "ok", tier: "pago", fellBack: true });
    expect(estado.chamadas.map((c) => c.options.model)).toEqual(["openrouter/free", "google/gemini-3.6-flash"]);
  });

  it("erro que o pago não resolve (chave recusada) não é repetido", async () => {
    estado.gratuitoFalha = 401;
    const r = await perguntar("Quanto gastamos em setembro?");
    expect(r.error).toBeDefined();
    expect(estado.chamadas).toHaveLength(1);
  });
});

