import { beforeEach, describe, expect, it, vi } from "vitest";
import { cartaoDoBanco } from "@/domain/cartoes";
import { parseCsv } from "@/importers/parse";

/**
 * Fatura sem final de cartao (o CSV do Nubank so tem data, descricao e
 * valor) - pedido da casa: a fatura do Nubank entrava "sem cartao" e o filtro
 * por cartao nao a achava.
 *
 * O que guarda: o banco vem do nome do arquivo; o cartao e o unico da casa
 * daquele banco, ou um novo com o nome dele; com dois do mesmo banco, nenhum
 * (nao se chuta a fatura de uma pessoa no cartao da outra); e o "Reanalisar"
 * liga as faturas que ja entraram sem cartao.
 */

const cartao = (id: string, name: string, institution: string | null = null, isActive = true) => ({ id, name, institution, isActive });

describe("cartaoDoBanco", () => {
  it("acha pela instituição ou pelo nome, sem ligar para acento e caixa", () => {
    expect(cartaoDoBanco([cartao("a", "C6 Vini", "C6"), cartao("b", "Roxinho", "nubank")], "Nubank")?.id).toBe("b");
    expect(cartaoDoBanco([cartao("a", "C6 Vini"), cartao("b", "Nubank da Lari")], "Nubank")?.id).toBe("b");
    expect(cartaoDoBanco([cartao("b", "NUBANK")], "Nubank")?.id).toBe("b");
  });

  it("palavra inteira: “Nu” não é Nubank, e cartão inativo não conta", () => {
    expect(cartaoDoBanco([cartao("a", "Nubankinho")], "Nubank")).toBeNull();
    expect(cartaoDoBanco([cartao("a", "Nubank", "Nubank", false)], "Nubank")).toBeNull();
  });

  it("dois do mesmo banco: nenhum, para a casa escolher", () => {
    expect(cartaoDoBanco([cartao("a", "Nubank Vini"), cartao("b", "Nubank Lari")], "Nubank")).toBeNull();
  });

  it("sem banco no arquivo: nenhum", () => {
    expect(cartaoDoBanco([cartao("a", "Nubank")], null)).toBeNull();
  });
});

describe("o arquivo do Nubank", () => {
  it("diz o banco pelo nome do arquivo e não traz o final do cartão", () => {
    const csv = [
      "date,title,amount",
      '2026-10-27,Maciel Decor Comercio - Parcela 1/3,"152,32"',
      '2026-10-13,Pagamento recebido,"- 500,00"',
    ].join("\n");
    const r = parseCsv(csv, { fileName: "Nubank_2026-11-04.csv" });
    expect(r.institution).toBe("Nubank");
    expect(r.drafts.length).toBeGreaterThan(0);
    expect(r.drafts.every((d) => d.cardLastFour === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gravacao e reanalise, com o banco simulado
// ---------------------------------------------------------------------------

type Chamada = { tabela: string; operacao: string; payload: unknown; filtros: [string, unknown][] };
const estado = {
  chamadas: [] as Chamada[],
  cartoes: [] as { id: string; name: string; institution: string | null; is_active: boolean }[],
  daFatura: [] as Record<string, unknown>[],
};

function tabela(nome: string) {
  const chamada: Chamada = { tabela: nome, operacao: "select", payload: null, filtros: [] };
  const resolver = () => {
    estado.chamadas.push(chamada);
    const { operacao } = chamada;
    if (operacao === "insert" && nome === "invoices") return { data: { id: "fatura-1" }, error: null };
    if (operacao === "insert" && nome === "cards") return { data: { id: "cartao-novo" }, error: null };
    if (operacao !== "select") return { data: null, error: null };
    if (nome === "cards") return { data: estado.cartoes, error: null };
    if (nome === "invoices") return { data: { institution: "Nubank", card_id: null }, error: null };
    if (nome === "transactions" && chamada.filtros.some(([f]) => f === "eq:invoice_id")) {
      return { data: estado.daFatura, error: null };
    }
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "gte", "lte", "order", "range", "limit", "single", "maybeSingle", "not", "or", "ilike"]) {
    b[m] = (campo: string, valor: unknown) => {
      chamada.filtros.push([`${m}:${campo}`, valor]);
      return b;
    };
  }
  b.select = () => b;
  for (const op of ["insert", "update", "upsert", "delete"]) {
    b[op] = (p: unknown) => {
      chamada.operacao = op;
      chamada.payload = p;
      return b;
    };
  }
  b.then = (ok: (r: unknown) => unknown) => Promise.resolve(resolver()).then(ok);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => null }));
vi.mock("@/lib/ai-usage", () => ({ recordAiUsage: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));

const { commitImport, reclassifyInvoice } = await import("@/actions/import");

const FATURA = "00000000-0000-4000-8000-0000000000f1";
const rascunho = (row: number) => ({
  row,
  date: "2026-10-27",
  invoiceMonth: "2026-11",
  description: "MACIEL DECOR",
  merchantOriginal: "Maciel Decor Comercio",
  merchantNormalized: "MACIEL DECOR",
  amountCents: 15_232,
  type: "expense",
  categoryHint: null,
  categoryId: null,
  cardLastFour: null,
  cardId: null,
  installmentCurrent: null,
  installmentTotal: null,
  duplicateKey: `k${row}`,
  decision: "new" as const,
});
const base = {
  invoiceMonth: "2026-11",
  cardId: null,
  memberId: null,
  fileName: "Nubank_2026-11-04.csv",
  fileHash: null,
  institution: "Nubank",
  format: "csv" as const,
  reportedTotalCents: null,
};
const operacoes = (t: string, op: string) => estado.chamadas.filter((c) => c.tabela === t && c.operacao === op);

beforeEach(() => {
  estado.chamadas.length = 0;
  estado.cartoes = [];
  estado.daFatura = [];
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
});

describe("gravação de fatura sem final", () => {
  it("sem cartão do banco: cria “Nubank”, liga a fatura e as linhas, e pede o nome", async () => {
    const r = await commitImport({ ...base, cartaoDoBanco: true, drafts: [rascunho(1), rascunho(2)] });
    expect(r.error).toBeUndefined();
    const [novo] = operacoes("cards", "insert");
    expect(novo!.payload).toEqual({ house_id: "casa-1", name: "Nubank", institution: "Nubank" });
    expect(operacoes("invoices", "insert")[0]!.payload).toMatchObject({ card_id: "cartao-novo" });
    const linhas = operacoes("transactions", "insert")[0]!.payload as { card_id: string }[];
    expect(linhas.map((l) => l.card_id)).toEqual(["cartao-novo", "cartao-novo"]);
    expect(r.cartoesNovos).toEqual([{ id: "cartao-novo", lastFour: null }]);
  });

  it("com o cartão do banco já cadastrado: usa ele, sem criar outro", async () => {
    estado.cartoes = [
      { id: "c6", name: "C6 Vini", institution: null, is_active: true },
      { id: "nu", name: "Nubank Vini", institution: null, is_active: true },
    ];
    const r = await commitImport({ ...base, cartaoDoBanco: true, drafts: [rascunho(1)] });
    expect(operacoes("cards", "insert")).toHaveLength(0);
    const linhas = operacoes("transactions", "insert")[0]!.payload as { card_id: string }[];
    expect(linhas[0]!.card_id).toBe("nu");
    expect(r.cartoesNovos).toEqual([]);
  });

  it("dois cartões do banco: nenhum, e nada é criado", async () => {
    estado.cartoes = [
      { id: "a", name: "Nubank Vini", institution: null, is_active: true },
      { id: "b", name: "Nubank Lari", institution: null, is_active: true },
    ];
    await commitImport({ ...base, cartaoDoBanco: true, drafts: [rascunho(1)] });
    expect(operacoes("cards", "insert")).toHaveLength(0);
    const linhas = operacoes("transactions", "insert")[0]!.payload as { card_id: string | null }[];
    expect(linhas[0]!.card_id).toBeNull();
  });

  it("a casa deixou “Sem cartão”: respeita, não cria nada", async () => {
    await commitImport({ ...base, cartaoDoBanco: false, drafts: [rascunho(1)] });
    expect(operacoes("cards", "insert")).toHaveLength(0);
    expect(operacoes("cards", "select")).toHaveLength(0);
  });
});

describe("Reanalisar uma fatura do Nubank que entrou sem cartão", () => {
  it("liga as linhas sem final ao cartão do banco, e a fatura também", async () => {
    estado.cartoes = [{ id: "nu", name: "Nubank", institution: "Nubank", is_active: true }];
    estado.daFatura = [
      { id: "t1", merchant_normalized: "MACIEL DECOR", type: "expense", amount: 152.32, date: "2026-10-27", category_id: "cat", subcategory_id: "sub", card_id: null, card_last_four: null },
      { id: "t2", merchant_normalized: "LEROY", type: "expense", amount: 89.8, date: "2026-10-21", category_id: "cat", subcategory_id: "sub", card_id: "ja-tinha", card_last_four: null },
    ];
    const r = await reclassifyInvoice(FATURA);
    expect(r.error).toBeUndefined();
    expect(r.cardsLinked).toBe(1);
    expect(r.withoutStoredCard).toBe(0);
    const ligar = operacoes("transactions", "update").find((c) => (c.payload as { card_id?: string }).card_id === "nu");
    expect(ligar!.filtros).toContainEqual(["in:id", ["t1"]]);
    // So onde estava vazio: o cartao escolhido a mao fica.
    expect(ligar!.filtros).toContainEqual(["is:card_id", null]);
    expect(operacoes("invoices", "update")[0]!.payload).toEqual({ card_id: "nu" });
  });
});
