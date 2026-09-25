import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O Jev na revisao e na gravacao da fatura.
 *
 * O que guarda: o Jev so troca categoria de fonte fraca (dica do banco ou
 * nada) - regra aprendida e loja conhecida vencem; o palpite chega marcado;
 * sem chave, nada sai para a rede; e a subcategoria que passou pelo navegador
 * e conferida de novo ao gravar.
 */

const ALI = "00000000-0000-4000-8000-000000000001";
const TRA = "00000000-0000-4000-8000-000000000002";
const TSH = "00000000-0000-4000-8000-000000000003";
const TRAB = "00000000-0000-4000-8000-000000000011";
const UBER = "00000000-0000-4000-8000-000000000012";

const CATEGORIAS = [
  { id: ALI, name: "Alimentacao", parent_id: null },
  { id: TRA, name: "Transporte", parent_id: null },
  { id: TSH, name: "TSH", parent_id: null },
  { id: TRAB, name: "Trabalho", parent_id: ALI },
  { id: UBER, name: "Uber", parent_id: TRA },
];

const estado = {
  chave: "sk-or-da-casa" as string | null,
  inseridos: [] as Record<string, unknown>[],
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
    if (nome === "learned_rules") {
      return {
        data: [{ normalized_pattern: "SUBITO RICE", category_id: ALI, subcategory_id: TRAB }],
        error: null,
      };
    }
    if (nome === "transactions" && colunas.includes("subcategory_id")) {
      return {
        data: [
          { category_id: ALI, subcategory_id: TRAB, merchant_normalized: "SUBITO RICE" },
          { category_id: TRA, subcategory_id: UBER, merchant_normalized: "UBER UBER TRIP" },
        ],
        error: null,
      };
    }
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "order", "range", "limit", "single", "maybeSingle"]) {
    b[m] = () => b;
  }
  b.select = (c?: string) => {
    if (operacao === "select") colunas = c ?? "";
    return b;
  };
  b.insert = (p: unknown) => {
    operacao = "insert";
    payload = p;
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

const RASCUNHOS = [
  rascunho(1, "UBERRIDES", { categoryHint: "Associação" }),
  rascunho(2, "SUBITO RICE"),
  rascunho(3, "POSTO IPIRANGA"),
];

/** O Jev de mentira: Transporte/Uber para o Uber; "nenhuma" para o resto. */
const perguntas: { state: string; questions: Record<string, unknown> }[] = [];
function jevFalso() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body));
    perguntas.push(corpo);
    const answers: Record<string, unknown> = {};
    for (const [nome, q] of Object.entries(corpo.questions as Record<string, { criteria: Record<string, string> }>)) {
      const chaves = Object.keys(q.criteria);
      const uber = String(corpo.state).includes("UBERRIDES");
      const escolha =
        nome === "categoria" ? "transporte" : uber && chaves.includes("uber") ? "uber" : "nenhuma";
      answers[nome] = { type: "choice", choice: escolha, probabilities: { [escolha]: 0.9 }, confidence: 0.9 };
    }
    return new Response(JSON.stringify({ answers }), { status: 200 });
  });
}

describe("reviewImport com o Jev", () => {
  beforeEach(() => {
    estado.chave = "sk-or-da-casa";
    perguntas.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("classifica o que as regras não resolviam, e marca como palpite", async () => {
    vi.stubGlobal("fetch", jevFalso());
    const r = await reviewImport({ drafts: RASCUNHOS, invoiceMonth: "2026-09", cardId: null, memberId: null });

    const uber = r.reviewed!.find((d) => d.row === 1)!;
    expect(uber).toMatchObject({
      categoryId: TRA,
      categoryName: "Transporte",
      categoryVia: "jev",
      jevProbability: 0.9,
      subcategoryId: UBER,
      subcategoryName: "Uber",
    });
    expect(r.notes?.join(" ")).toMatch(/O Jev classificou 1 lançamento/);
  });

  it("regra aprendida nem vai ao Jev; loja conhecida só tem a subcategoria perguntada", async () => {
    vi.stubGlobal("fetch", jevFalso());
    const r = await reviewImport({ drafts: RASCUNHOS, invoiceMonth: "2026-09", cardId: null, memberId: null });

    const estados = perguntas.map((p) => p.state).join("\n");
    expect(estados).not.toMatch(/SUBITO RICE/);
    const posto = perguntas.find((p) => p.state.includes("POSTO IPIRANGA"))!;
    expect(Object.keys(posto.questions)).toEqual(["sub_1"]);

    // E o que a loja conhecida decidiu nao muda.
    expect(r.reviewed!.find((d) => d.row === 3)).toMatchObject({ categoryId: TRA });
    expect(r.reviewed!.find((d) => d.row === 3)?.categoryVia).toBeUndefined();
    expect(r.reviewed!.find((d) => d.row === 2)).toMatchObject({ categoryId: ALI });
  });

  it("o que sai para o Jev é a loja e os números — nada de pessoa, cartão ou casa", async () => {
    vi.stubGlobal("fetch", jevFalso());
    await reviewImport({ drafts: RASCUNHOS, invoiceMonth: "2026-09", cardId: null, memberId: null });
    const enviado = JSON.stringify(perguntas);
    expect(enviado).not.toMatch(/casa-1|user-1|sk-or/);
  });

  it("sem chave, nada sai para a rede e a revisão é a de sempre", async () => {
    estado.chave = null;
    const fetch = jevFalso();
    vi.stubGlobal("fetch", fetch);
    const r = await reviewImport({ drafts: RASCUNHOS, invoiceMonth: "2026-09", cardId: null, memberId: null });
    expect(fetch).not.toHaveBeenCalled();
    expect(r.reviewed!.some((d) => d.categoryVia === "jev")).toBe(false);
  });

  it("Jev fora do ar: a revisão segue, com um aviso", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 402 })));
    const r = await reviewImport({ drafts: RASCUNHOS, invoiceMonth: "2026-09", cardId: null, memberId: null });
    expect(r.error).toBeUndefined();
    expect(r.notes?.join(" ")).toMatch(/sem créditos/);
  });
});

describe("commitImport confere a subcategoria que veio do navegador", () => {
  beforeEach(() => {
    estado.inseridos = [];
  });

  const gravar = (drafts: Record<string, unknown>[]) =>
    commitImport({
      drafts: drafts.map((d) => ({ ...d, decision: "new" })),
      invoiceMonth: "2026-09",
      cardId: null,
      memberId: null,
      fileName: "fatura.csv",
      fileHash: null,
      institution: null,
      format: "csv",
      reportedTotalCents: null,
    });

  it("filha da categoria da linha: grava", async () => {
    await gravar([rascunho(1, "UBERRIDES", { categoryId: TRA, subcategoryId: UBER })]);
    expect(estado.inseridos[0]).toMatchObject({ category_id: TRA, subcategory_id: UBER });
  });

  it("de outra categoria (ou inventada): descarta", async () => {
    await gravar([
      rascunho(1, "UBERRIDES", { categoryId: ALI, subcategoryId: UBER }),
      rascunho(2, "OUTRA", { categoryId: TRA, subcategoryId: "00000000-0000-4000-8000-0000000000ff" }),
    ]);
    expect(estado.inseridos.map((r) => r.subcategory_id)).toEqual([null, null]);
  });

  it("regra aprendida vence a proposta", async () => {
    await gravar([rascunho(1, "SUBITO RICE", { categoryId: ALI, subcategoryId: null })]);
    expect(estado.inseridos[0]).toMatchObject({ subcategory_id: TRAB });
  });
});
