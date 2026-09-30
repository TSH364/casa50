import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Historico da loja e regra do Jev, na importacao.
 *
 * O que guarda: loja que a casa sempre pos no mesmo lugar e decidida pelo
 * historico, sem IA, e marcada como tal; palpite do Jev no historico nao
 * decide nada; loja que variou vai ao Jev com o historico como pista; ao
 * gravar, cada lancamento leva a origem da categoria, e o palpite com 85%+
 * vira regra do Jev (certeza < 1), sem passar por cima de regra existente.
 */

const SAU = "00000000-0000-4000-8000-000000000001";
const TSH = "00000000-0000-4000-8000-000000000002";
const ALI = "00000000-0000-4000-8000-000000000003";
const LAZ = "00000000-0000-4000-8000-000000000004";

const CATEGORIAS = [
  { id: SAU, name: "Saude", parent_id: null },
  { id: TSH, name: "TSH", parent_id: null },
  { id: ALI, name: "Alimentacao", parent_id: null },
  { id: LAZ, name: "Lazer", parent_id: null },
];

/** O que a casa ja fez: PETLOVE sempre Saude; MERCADOLIVRE variou; CLUBE so por palpite. */
const HISTORICO = [
  { merchant_normalized: "PETLOVE", category_id: SAU, category_source: "casa" },
  { merchant_normalized: "PETLOVE", category_id: SAU, category_source: null },
  { merchant_normalized: "MERCADOLIVRE", category_id: TSH, category_source: "casa" },
  { merchant_normalized: "MERCADOLIVRE", category_id: TSH, category_source: "regra" },
  { merchant_normalized: "MERCADOLIVRE", category_id: TSH, category_source: "casa" },
  { merchant_normalized: "MERCADOLIVRE", category_id: ALI, category_source: "casa" },
  { merchant_normalized: "CLUBE", category_id: LAZ, category_source: "jev" },
  { merchant_normalized: "CLUBE", category_id: LAZ, category_source: "jev" },
];

const estado = {
  chave: null as string | null,
  inseridos: [] as Record<string, unknown>[],
  regras: [] as { payload: Record<string, unknown>[]; opcoes: unknown }[],
  regrasExistentes: [] as Record<string, unknown>[],
};

type Resultado = { data: unknown; error: null };

function tabela(nome: string) {
  let colunas = "";
  let operacao = "select";
  let payload: unknown = null;
  const resolver = (): Resultado => {
    if (operacao === "insert" && nome === "transactions") {
      estado.inseridos.push(...(payload as Record<string, unknown>[]));
      return { data: null, error: null };
    }
    if (operacao === "insert" && nome === "invoices") return { data: { id: "fatura-1" }, error: null };
    if (nome === "categories") return { data: CATEGORIAS, error: null };
    if (nome === "learned_rules") return { data: estado.regrasExistentes, error: null };
    if (nome === "transactions" && colunas.includes("category_source")) return { data: HISTORICO, error: null };
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "order", "range", "limit", "single", "maybeSingle"]) b[m] = () => b;
  b.select = (c?: string) => {
    if (operacao === "select") colunas = c ?? "";
    return b;
  };
  b.insert = (p: unknown) => {
    operacao = "insert";
    payload = p;
    return b;
  };
  b.upsert = (p: Record<string, unknown>[], opcoes: unknown) => {
    estado.regras.push({ payload: p, opcoes });
    operacao = "upsert";
    return b;
  };
  b.delete = () => {
    operacao = "delete";
    return b;
  };
  b.then = (ok: (r: Resultado) => unknown) => Promise.resolve(resolver()).then(ok);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => estado.chave }));
vi.mock("@/lib/ai-usage", () => ({ recordAiUsage: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));

const { reviewImport, commitImport } = await import("@/actions/import");

function rascunho(row: number, merchant: string, extra: Record<string, unknown> = {}) {
  return {
    row,
    date: "2026-09-21",
    invoiceMonth: "2026-09",
    description: merchant,
    merchantOriginal: merchant,
    merchantNormalized: merchant,
    amountCents: 2_350,
    type: "expense",
    categoryHint: null,
    categoryId: null,
    cardLastFour: null,
    cardId: null,
    installmentCurrent: null,
    installmentTotal: null,
    duplicateKey: `k${row}`,
    ...extra,
  };
}

beforeEach(() => {
  estado.chave = null;
  estado.inseridos.length = 0;
  estado.regras.length = 0;
  estado.regrasExistentes = [];
});

describe("revisão com o histórico da loja", () => {
  let fetchOriginal: typeof fetch;
  const estados: string[] = [];
  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    estados.length = 0;
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body));
      estados.push(String(corpo.state));
      const answers: Record<string, unknown> = {};
      for (const nome of Object.keys(corpo.questions)) {
        answers[nome] = { type: "choice", choice: "tsh", probabilities: { tsh: 0.9 }, confidence: 0.9 };
      }
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("loja consistente: decidida pelo histórico, sem IA; palpite antigo do Jev não decide", async () => {
    const r = await reviewImport({ drafts: [rascunho(1, "PETLOVE"), rascunho(2, "CLUBE")], invoiceMonth: "2026-09", cardId: null, memberId: null });
    const [petlove, clube] = r.reviewed!;
    expect(petlove).toMatchObject({ categoryId: SAU, categorySource: "historico" });
    expect(clube).toMatchObject({ categoryId: null, categorySource: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("loja que variou: vai ao Jev com o histórico como pista", async () => {
    estado.chave = "sk-or-da-casa";
    const r = await reviewImport({ drafts: [rascunho(1, "MERCADOLIVRE")], invoiceMonth: "2026-09", cardId: null, memberId: null });
    expect(estados.join("\n")).toMatch(/Na casa, esta loja já foi classificada como TSH \(3 vezes\) e Alimentacao \(1 vez\)\./);
    expect(r.reviewed![0]).toMatchObject({ categoryId: TSH, categorySource: "jev", categoryVia: "jev" });
  });
});

describe("gravação", () => {
  const base = { invoiceMonth: "2026-09", cardId: null, memberId: null, fileName: "f.csv", fileHash: null, institution: null, format: "csv", reportedTotalCents: null };

  it("cada lançamento leva a origem; palpite com 85%+ vira regra do Jev (certeza < 1)", async () => {
    const r = await commitImport({
      ...base,
      drafts: [
        rascunho(1, "PETLOVE", { categoryId: SAU, categorySource: "historico", decision: "new" }),
        rascunho(2, "LOJA NOVA", { categoryId: LAZ, categorySource: "jev", jevProbability: 0.91, decision: "new" }),
        rascunho(3, "LOJA NOVA", { categoryId: LAZ, categorySource: "jev", jevProbability: 0.88, decision: "new" }),
        rascunho(4, "LOJA INCERTA", { categoryId: ALI, categorySource: "jev", jevProbability: 0.7, decision: "new" }),
      ],
    });
    expect(r.error).toBeUndefined();
    expect(estado.inseridos.map((t) => [t.description, t.category_source])).toEqual([
      ["PETLOVE", "historico"],
      ["LOJA NOVA", "jev"],
      ["LOJA NOVA", "jev"],
      ["LOJA INCERTA", "jev"],
    ]);
    expect(estado.regras).toHaveLength(1);
    expect(estado.regras[0]!.payload).toEqual([
      { house_id: "casa-1", pattern: "LOJA NOVA", category_id: LAZ, confidence: 0.88, created_by: "user-1" },
    ]);
    expect(estado.regras[0]!.opcoes).toEqual({ onConflict: "house_id,normalized_pattern", ignoreDuplicates: true });
  });

  it("não passa por cima de regra que a casa já tem", async () => {
    estado.regrasExistentes = [{ normalized_pattern: "LOJA NOVA", category_id: ALI, subcategory_id: null }];
    await commitImport({
      ...base,
      drafts: [rascunho(1, "LOJA NOVA", { categoryId: LAZ, categorySource: "jev", jevProbability: 0.95, decision: "new" })],
    });
    expect(estado.regras).toHaveLength(0);
  });
});
