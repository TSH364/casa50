import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A releitura de uma fatura ja gravada, agora com o Jev.
 *
 * O que guarda: so o VAZIO e preenchido (categoria nula; subcategoria nula
 * sob categoria que ja existe); regra aprendida vence o Jev; o Jev so troca
 * a categoria de fonte fraca; cada gravacao leva a trava que protege o que
 * alguem mudou a mao nesse meio-tempo; e a resposta diz quanto veio do Jev.
 */

const ALI = "00000000-0000-4000-8000-000000000001";
const TRA = "00000000-0000-4000-8000-000000000002";
const TRAB = "00000000-0000-4000-8000-000000000011";
const UBER = "00000000-0000-4000-8000-000000000012";
const FATURA = "00000000-0000-4000-8000-0000000000fa";

const CATEGORIAS = [
  { id: ALI, name: "Alimentacao", parent_id: null },
  { id: TRA, name: "Transporte", parent_id: null },
  { id: TRAB, name: "Trabalho", parent_id: ALI },
  { id: UBER, name: "Uber", parent_id: TRA },
];

const linha = (id: string, merchant: string, extra: Record<string, unknown> = {}) => ({
  id, merchant_normalized: merchant, merchant_original: merchant, description: merchant,
  amount: 23.5, date: "2026-09-22", type: "expense", category_hint: null,
  category_id: null, subcategory_id: null, card_id: "k", card_last_four: "1234", ...extra,
});

const LINHAS = [
  linha("t-uber", "UBERRIDES", { category_hint: "Associação" }), // fraca: vai ao Jev
  linha("t-regra", "SUBITO RICE"), // regra aprendida decide tudo
  linha("t-sub", "99 RIDE", { category_id: TRA }), // tem categoria, falta sub
  linha("t-feita", "POSTO", { category_id: TRA, subcategory_id: UBER }), // completa: nada
];

const estado = {
  chave: "sk-or-da-casa" as string | null,
  escritas: [] as { payload: unknown; filtros: unknown[] }[],
};

function tabela(nome: string) {
  let op = "select";
  let colunas = "";
  let payload: unknown;
  const filtros: unknown[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["order", "range", "limit", "single", "maybeSingle"]) b[m] = () => b;
  for (const m of ["eq", "is", "in"]) {
    b[m] = (...args: unknown[]) => {
      filtros.push([m, ...args]);
      return b;
    };
  }
  b.select = (c?: string) => {
    if (op === "select") colunas = c ?? "";
    return b;
  };
  b.update = (p: unknown) => {
    op = "update";
    payload = p;
    return b;
  };
  b.then = (ok: (r: unknown) => unknown) => {
    let data: unknown = [];
    if (op === "update") estado.escritas.push({ payload, filtros });
    else if (nome === "categories") data = CATEGORIAS;
    else if (nome === "learned_rules") {
      data = [{ normalized_pattern: "SUBITO RICE", category_id: ALI, subcategory_id: TRAB }];
    } else if (nome === "transactions" && colunas.includes("card_last_four")) data = LINHAS;
    else if (nome === "transactions") {
      // Exemplos para o Jev (loadJevContext).
      data = [{ category_id: TRA, subcategory_id: UBER, merchant_normalized: "UBER UBER TRIP" }];
    }
    return Promise.resolve({ data, error: null }).then(ok);
  };
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

const { reclassifyInvoice } = await import("@/actions/import");

/** Jev falso: Transporte/Uber para qualquer loja de corrida. */
function jev() {
  return vi.fn(async (_u: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body));
    const answers: Record<string, unknown> = {};
    for (const [nome, q] of Object.entries(corpo.questions as Record<string, { criteria: Record<string, string> }>)) {
      const chaves = Object.keys(q.criteria);
      const escolha = nome === "categoria" ? "transporte" : chaves.includes("uber") ? "uber" : "nenhuma";
      answers[nome] = { choice: escolha, probabilities: { [escolha]: 0.93 } };
    }
    return new Response(JSON.stringify({ answers }), { status: 200 });
  });
}

const escritaDe = (id: string) =>
  estado.escritas.find((e) => e.filtros.some((f) => (f as unknown[])[0] === "in" && ((f as unknown[])[2] as string[]).includes(id)));

describe("reclassifyInvoice com o Jev", () => {
  beforeEach(() => {
    estado.chave = "sk-or-da-casa";
    estado.escritas = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("categoria vazia de fonte fraca: o Jev decide, e a gravação só pega o que ainda está vazio", async () => {
    vi.stubGlobal("fetch", jev());
    const r = await reclassifyInvoice(FATURA);
    const e = escritaDe("t-uber")!;
    expect(e.payload).toEqual({ category_id: TRA, subcategory_id: UBER });
    expect(e.filtros).toContainEqual(["is", "category_id", null]);
    expect(r).toMatchObject({ updated: 2, remaining: 0 });
  });

  it("regra aprendida vence: a loja da regra nem é perguntada, e grava o que a regra manda", async () => {
    const fetch = jev();
    vi.stubGlobal("fetch", fetch);
    await reclassifyInvoice(FATURA);
    const estados = fetch.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).state).join("\n");
    expect(estados).not.toMatch(/SUBITO RICE/);
    expect(escritaDe("t-regra")!.payload).toEqual({ category_id: ALI, subcategory_id: TRAB });
  });

  it("tem categoria e falta sub: preenche só a sub, com a categoria travada", async () => {
    vi.stubGlobal("fetch", jev());
    const r = await reclassifyInvoice(FATURA);
    const e = escritaDe("t-sub")!;
    expect(e.payload).toEqual({ subcategory_id: UBER });
    expect(e.filtros).toContainEqual(["eq", "category_id", TRA]);
    expect(e.filtros).toContainEqual(["is", "subcategory_id", null]);
    expect(r.subcategorized).toBe(1);
  });

  it("o que já está completo não é tocado", async () => {
    vi.stubGlobal("fetch", jev());
    await reclassifyInvoice(FATURA);
    expect(escritaDe("t-feita")).toBeUndefined();
  });

  it("conta o que veio do Jev", async () => {
    vi.stubGlobal("fetch", jev());
    const r = await reclassifyInvoice(FATURA);
    // UBERRIDES (categoria e sub) e 99 RIDE (sub); SUBITO RICE foi pela regra.
    expect(r.byJev).toBe(2);
  });

  it("sem chave: só as regras, como antes — e nada sai para a rede", async () => {
    estado.chave = null;
    const fetch = jev();
    vi.stubGlobal("fetch", fetch);
    const r = await reclassifyInvoice(FATURA);
    expect(fetch).not.toHaveBeenCalled();
    expect(escritaDe("t-regra")).toBeDefined();
    expect(escritaDe("t-sub")).toBeUndefined();
    // A dica do banco ("Associação") nao traduz para nada: fica sem categoria.
    expect(r).toMatchObject({ updated: 1, byJev: 0 });
  });
});
