import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFacts, checkAnalyses, numbersIn, type Fact } from "@/domain/ai-insights";
import type { Category, Transaction } from "@/domain/types";

/**
 * A analise do mes com IA.
 *
 * O que guarda: os fatos saem calculados pelo app (e nao pela IA); analise
 * com numero que nao esta nos fatos e descartada; arredondar e permitido,
 * inventar nao; a evidencia vem dos fatos; e a acao usa o modelo pago,
 * registra o gasto e nao grava nada quando nenhuma analise sobrevive.
 */

function tx(o: Partial<Transaction> = {}): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    houseId: "casa",
    invoiceId: null,
    cardId: null,
    memberId: null,
    isJoint: false,
    date: "2026-09-10",
    invoiceMonth: "2026-09",
    description: "COMPRA",
    merchantOriginal: null,
    merchantNormalized: "COMPRA",
    merchantAlias: null,
    amount: 100,
    currency: "BRL",
    originalAmount: null,
    originalCurrency: null,
    type: "expense",
    origin: "manual",
    status: "confirmed",
    categoryId: null,
    subcategoryId: null,
    note: null,
    receiptUrl: null,
    visibility: "shared",
    splitType: "none",
    splitPercentage: null,
    installment: null,
    recurringId: null,
    reconciledWithId: null,
    calendarEventId: null,
    eventLinkDecided: false,
    isHidden: false,
    isReconciled: false,
    createdBy: null,
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
    ...o,
  } as Transaction;
}

const cat = (id: string, name: string): Category =>
  ({ id, houseId: "casa", name, color: "#000", icon: null, parentId: null, isActive: true, excludedFromTotals: false }) as Category;

const MERCADO = cat("c-m", "Mercado");
const DELIVERY = cat("c-d", "Delivery");

function historico(): Transaction[] {
  const out: Transaction[] = [];
  for (const mes of ["2026-06", "2026-07", "2026-08"]) {
    out.push(tx({ invoiceMonth: mes, date: `${mes}-05`, amount: 1000, categoryId: MERCADO.id, merchantNormalized: "ZAFFARI", description: "ZAFFARI" }));
    out.push(tx({ invoiceMonth: mes, date: `${mes}-06`, amount: 200, categoryId: DELIVERY.id, merchantNormalized: "IFOOD", description: "IFOOD" }));
  }
  // Setembro: delivery triplicou, e uma loja nova.
  out.push(tx({ amount: 1000, categoryId: MERCADO.id, merchantNormalized: "ZAFFARI", description: "ZAFFARI", date: "2026-09-08" }));
  out.push(tx({ amount: 600, categoryId: DELIVERY.id, merchantNormalized: "IFOOD", description: "IFOOD", date: "2026-09-09", isJoint: true }));
  out.push(tx({ amount: 350, categoryId: MERCADO.id, merchantNormalized: "EMPORIO NOVO", description: "EMPORIO NOVO", date: "2026-09-10", memberId: "v" }));
  return out;
}

function fatos(): Fact[] {
  return buildFacts({
    month: "2026-09",
    transactions: historico(),
    categories: [MERCADO, DELIVERY],
    budgets: [{ id: "b", houseId: "casa", categoryId: DELIVERY.id, month: "2026-09", limitAmount: 500 }],
    recurrenceMatches: [],
    members: [
      { id: "v", name: "Vinicius" },
      { id: "l", name: "Larissa" },
    ],
    insights: [],
  });
}

const valor = (fs: Fact[], prefixo: string) => fs.find((f) => f.label.startsWith(prefixo))?.value ?? "";

describe("buildFacts", () => {
  it("o app calcula total, média, categoria contra a média, loja nova, pessoa e orçamento", () => {
    const fs = fatos();
    expect(fs.map((f) => f.id).slice(0, 3)).toEqual(["F1", "F2", "F3"]);
    expect(valor(fs, "Gasto de")).toMatch(/1\.950,00/);
    expect(valor(fs, "Média de gasto dos 3 meses")).toMatch(/1\.200,00/);
    expect(valor(fs, "Categoria Delivery")).toMatch(/600,00.*média anterior R\$\s*200,00, diferença \+R\$\s*400,00/);
    expect(fs.some((f) => f.label.includes("Loja nova") && f.label.includes("EMPORIO NOVO"))).toBe(true);
    expect(valor(fs, "Gasto por pessoa: os dois")).toMatch(/600,00/);
    expect(valor(fs, "Gasto por pessoa: Vinicius")).toMatch(/350,00/);
    expect(fs.some((f) => f.label.startsWith("Gasto em sábados"))).toBe(false);
    expect(valor(fs, "Loja ZAFFARI")).toMatch(/1\.000,00 em 1 compra/);
    expect(valor(fs, "Orçamento de Delivery")).toMatch(/600,00 de R\$\s*500,00 \(120%\)/);
  });
});

describe("numbersIn", () => {
  it("lê valores em pt-BR e ignora contagens pequenas e anos", () => {
    expect(numbersIn("R$ 1.234,56 e 32% em 3 meses de 2026; 1,2 mil")).toEqual([1234.56, 32, 1200]);
  });
});

describe("checkAnalyses", () => {
  const fs: Fact[] = [
    { id: "F1", label: "Gasto de setembro de 2026", value: "R$ 1.950,00" },
    { id: "F2", label: "Categoria Delivery no mês", value: "R$ 600,00; média anterior R$ 200,00, diferença +R$ 400,00" },
    { id: "F3", label: "Loja IFOOD", value: "R$ 600,00 em 1 compra(s)" },
  ];
  const resposta = (analises: unknown[]) => "```json\n" + JSON.stringify({ analises }) + "\n```";

  it("aceita número dos fatos (e arredondado); a evidência vem dos fatos", () => {
    const r = checkAnalyses(
      resposta([
        { titulo: "Delivery triplicou", texto: "Foram R$ 600 contra R$ 200 de média; todo no IFOOD.", tom: "atenção", fatos: ["F2"], sugestao: "Combinar um dia sem delivery." },
      ]),
      fs,
    )!;
    expect(r.dropped).toBe(0);
    expect(r.items[0]).toMatchObject({ tone: "attention", suggestion: "Combinar um dia sem delivery." });
    expect(r.items[0]!.evidence).toEqual([{ label: fs[1]!.label, value: fs[1]!.value }]);
  });

  it("número inventado derruba a análise; número de fato não citado entra na evidência", () => {
    const r = checkAnalyses(
      resposta([
        { titulo: "Inventada", texto: "Vocês gastaram R$ 873,00 com lanches.", tom: "neutro", fatos: ["F1"] },
        { titulo: "Esqueceu de citar", texto: "O mês fechou em R$ 1.950,00.", tom: "neutro", fatos: ["F3"] },
        { titulo: "Sem fato", texto: "Tudo bem.", tom: "positivo", fatos: ["F99"] },
      ]),
      fs,
    )!;
    expect(r.dropped).toBe(2);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.evidence.map((e) => e.value)).toEqual([fs[2]!.value, fs[0]!.value]);
  });

  it("resposta que não é JSON: nulo", () => {
    expect(checkAnalyses("Desculpe, não consigo.", fs)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const estado = {
  resposta: "",
  corpos: [] as Record<string, unknown>[],
  gravado: [] as unknown[],
  usos: [] as unknown[],
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => "sk-or-da-casa" }));
vi.mock("@/lib/ai-usage", () => ({ recordAiUsage: async (...a: unknown[]) => estado.usos.push(a) }));
vi.mock("@/lib/house-view", () => ({
  SHOW_ALL: "tudo",
  houseView: async () => ({ categories: [MERCADO, DELIVERY], excludeCategoryIds: [], excluded: [], showingAll: false }),
}));
vi.mock("@/lib/houses", () => ({
  listMembers: async () => [{ userId: "v", fullName: "Vinicius Roselli", email: "x@y", role: "owner" }],
}));
vi.mock("@/data/queries", () => ({
  listTransactions: async () => historico(),
  listBudgets: async () => [],
  listRecurrences: async () => [],
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "v" }),
  createClient: async () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.insert = (v: unknown) => {
        estado.gravado.push(v);
        return b;
      };
      b.select = () => b;
      b.single = async () => ({ data: { created_at: "2026-09-26T12:00:00Z" }, error: null });
      return b;
    },
  }),
}));

const fetchOriginal = globalThis.fetch;
const { analyzeMonth } = await import("@/actions/ai-insights");

describe("analyzeMonth", () => {
  beforeEach(() => {
    estado.corpos = [];
    estado.gravado = [];
    estado.usos = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      estado.corpos.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ model: "google/gemini-3.6-flash", choices: [{ message: { content: estado.resposta } }], usage: { cost: 0.0021 } }),
        { status: 200 },
      );
    }) as typeof fetch;
  });

  it("modelo pago sem guarda de dados; só fatos no pedido; grava a análise conferida e o gasto", async () => {
    estado.resposta = JSON.stringify({
      analises: [{ titulo: "Delivery subiu", texto: "R$ 600,00 no mês, contra R$ 200,00 de média.", tom: "atencao", fatos: ["F5"] }],
    });
    const r = await analyzeMonth({ month: "2026-09", scope: "casa" });
    globalThis.fetch = fetchOriginal;

    expect(r.error).toBeUndefined();
    expect(r.analysis!.items[0]!.title).toBe("Delivery subiu");
    const corpo = estado.corpos[0]!;
    expect(corpo.model).toBe("google/gemini-3.6-flash");
    expect(corpo.provider).toEqual({ data_collection: "deny" });
    const pedido = JSON.stringify(corpo.messages);
    expect(pedido).toMatch(/F1: Gasto de/);
    expect(pedido).not.toMatch(/x@y|Roselli/);
    expect(estado.gravado[0]).toMatchObject({ house_id: "casa-1", month: "2026-09", scope: "casa", created_by: "v" });
    expect(estado.usos[0]).toEqual(["casa-1", "insights", { calls: 1, costUsd: 0.0021, model: "google/gemini-3.6-flash" }]);
  });

  it("nenhuma análise confere: erro, nada gravado, mas o gasto é registrado", async () => {
    estado.resposta = JSON.stringify({ analises: [{ titulo: "x", texto: "R$ 9.999,00 sumiram.", tom: "neutro", fatos: ["F1"] }] });
    const r = await analyzeMonth({ month: "2026-09", scope: "casa" });
    globalThis.fetch = fetchOriginal;
    expect(r.error).toMatch(/nenhuma análise/);
    expect(estado.gravado).toHaveLength(0);
    expect(estado.usos).toHaveLength(1);
  });
});
