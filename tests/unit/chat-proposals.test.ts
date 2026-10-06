import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/domain/types";
import type { ChartSpec, Proposal } from "@/domain/chat";

/**
 * As propostas da conversa: a IA propoe, a casa confirma.
 *
 * O que guarda: as ferramentas de propor NAO gravam nada; apontam por codigo
 * ou por loja (e por loja so pega o que esta sem categoria); categoria,
 * subcategoria e pessoa sao conferidas; e a confirmacao revalida tudo no
 * servidor, escopada a casa, e so aprende a regra quando a casa quer.
 */

const VINI = "11111111-1111-4111-8111-111111111111";
const LARI = "22222222-2222-4222-8222-222222222222";
const ALI = "aaaaaaaa-0000-4000-8000-000000000001";
const TRA = "aaaaaaaa-0000-4000-8000-000000000002";
const UBER = "aaaaaaaa-0000-4000-8000-000000000012";
const TRAB = "aaaaaaaa-0000-4000-8000-000000000011";

const CATS = [
  { id: ALI, houseId: "casa-1", name: "Alimentacao", color: "#f00", icon: null, parentId: null, isActive: true, kind: "expense" as const, excludedFromTotals: false },
  { id: TRA, houseId: "casa-1", name: "Transporte", color: "#00f", icon: null, parentId: null, isActive: true, kind: "expense" as const, excludedFromTotals: false },
  { id: UBER, houseId: "casa-1", name: "Uber", color: "#00f", icon: null, parentId: TRA, isActive: true, kind: "expense" as const, excludedFromTotals: false },
  { id: TRAB, houseId: "casa-1", name: "Trabalho", color: "#f00", icon: null, parentId: ALI, isActive: true, kind: "expense" as const, excludedFromTotals: false },
];

function tx(id: string, p: Partial<Transaction>): Transaction {
  return {
    id, houseId: "casa-1", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: "2026-09-10", invoiceMonth: "2026-09", description: "x", merchantOriginal: null,
    merchantNormalized: null, merchantAlias: null, amount: 20, currency: "BRL", originalAmount: null,
    originalCurrency: null, type: "expense", origin: "invoice", status: "confirmed", categoryId: null,
    subcategoryId: null, note: null, receiptUrl: null, visibility: "shared", splitType: "none",
    splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null, calendarEventId: null,
    eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null, createdAt: "", updatedAt: "",
    ...p,
  };
}

const LANC = [
  tx("abcd1111-0000-4000-8000-000000000001", { merchantNormalized: "UBERRIDES", description: "UBERRIDES", amount: 23.5 }),
  tx("abcd2222-0000-4000-8000-000000000002", { merchantNormalized: "UBERRIDES", description: "UBERRIDES", amount: 31 }),
  // Mesma loja, ja classificada a mao: a proposta por loja NAO pega.
  tx("abcd3333-0000-4000-8000-000000000003", { merchantNormalized: "UBERRIDES", description: "UBERRIDES", categoryId: ALI }),
  tx("beef4444-0000-4000-8000-000000000004", { merchantNormalized: "PADARIA", description: "PADARIA", amount: 12 }),
  // Dois ids com o mesmo comeco: codigo ambiguo.
  tx("d0d00000-0000-4000-8000-000000000005", { merchantNormalized: "X", description: "X" }),
  tx("d0d00000-1111-4000-8000-000000000006", { merchantNormalized: "Y", description: "Y" }),
];

const db = {
  escritas: [] as { tabela: string; op: string; payload: unknown; filtros: unknown[] }[],
  categorias: [
    { id: ALI, parent_id: null }, { id: TRA, parent_id: null }, { id: UBER, parent_id: TRA }, { id: TRAB, parent_id: ALI },
  ],
};

function tabela(nome: string) {
  let op = "select";
  let payload: unknown;
  const filtros: unknown[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "range", "limit"]) b[m] = () => b;
  for (const m of ["eq", "in", "is"]) b[m] = (...a: unknown[]) => { filtros.push([m, ...a]); return b; };
  for (const m of ["update", "insert", "upsert"]) b[m] = (p: unknown) => { op = m; payload = p; return b; };
  b.then = (ok: (r: unknown) => unknown) => {
    if (op !== "select") db.escritas.push({ tabela: nome, op, payload, filtros });
    let data: unknown = [];
    if (nome === "categories") {
      const ids = (filtros.find((f) => (f as unknown[])[0] === "in") as unknown[] | undefined)?.[2] as string[] | undefined;
      data = db.categorias.filter((c) => !ids || ids.includes(c.id));
    } else if (nome === "transactions" && op === "update") {
      const ids = (filtros.find((f) => (f as unknown[])[0] === "in") as unknown[])[2] as string[];
      data = ids.map((id) => ({ id }));
    }
    return Promise.resolve({ data, error: null }).then(ok);
  };
  return b;
}

const estado = { casa: true };

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({
  requireHouseId: async () => {
    if (!estado.casa) throw new Error("Nenhuma casa ativa.");
    return "casa-1";
  },
}));
vi.mock("@/lib/houses", () => ({
  listMembers: async () => [
    { userId: VINI, fullName: "Vinicius Roselli", email: "", role: "owner" },
    { userId: LARI, fullName: "Larissa Souza", email: "", role: "member" },
  ],
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));
vi.mock("@/data/queries", () => ({
  listTransactions: async (_h: string, f: { categoryId?: string | null }) =>
    LANC.filter((t) => (f.categoryId === "sem" ? t.categoryId === null : true)),
}));

const { runTool } = await import("@/lib/chat-tools");
const { applyProposal } = await import("@/actions/chat");

const ctx = () => ({
  houseId: "casa-1",
  today: "2026-09",
  todayIso: "2026-09-26",
  members: [
    { userId: VINI, fullName: "Vinicius Roselli", email: "", role: "owner" as const },
    { userId: LARI, fullName: "Larissa Souza", email: "", role: "member" as const },
  ],
  categories: CATS,
  excludeCategoryIds: [],
  proposals: [] as Proposal[],
  charts: [] as ChartSpec[], searches: [],
});

describe("ferramentas de propor", () => {
  beforeEach(() => {
    db.escritas = [];
  });

  it("listar sem categoria: por loja, com os códigos", async () => {
    const r = await runTool(ctx(), "listar_sem_categoria", "{}");
    expect(r.output).toMatch(/5 lançamento\(s\)/);
    expect(r.output).toMatch(/UBERRIDES: 2× · R\$\s?54,50 · #abcd1111 #abcd2222/);
  });

  it("classificar por loja: só os sem categoria, e nada é gravado", async () => {
    const c = ctx();
    const r = await runTool(c, "propor_classificacao", JSON.stringify({ loja: "UBERRIDES", categoria: "Transporte", subcategoria: "Uber" }));
    expect(r.output).toMatch(/ainda NÃO gravada/);
    expect(c.proposals).toHaveLength(1);
    expect(c.proposals[0]).toMatchObject({
      kind: "classificar",
      categoryId: TRA,
      subcategoryId: UBER,
      learnMerchant: "UBERRIDES",
      transactionIds: ["abcd1111-0000-4000-8000-000000000001", "abcd2222-0000-4000-8000-000000000002"],
      summary: { categoryLabel: "Transporte › Uber", count: 2, totalCents: 5450 },
    });
    expect(db.escritas).toEqual([]);
  });

  it("classificar por código: pega aquele, mesmo já classificado (foi apontado)", async () => {
    const c = ctx();
    await runTool(c, "propor_classificacao", JSON.stringify({ codigos: ["#abcd3333"], categoria: "Uber" }));
    // "Uber" e subcategoria: a mae vem junto.
    expect(c.proposals[0]).toMatchObject({ transactionIds: ["abcd3333-0000-4000-8000-000000000003"], categoryId: TRA, subcategoryId: UBER });
  });

  it("código ambíguo, código inexistente, sub de outra mãe: frase para o modelo, sem proposta", async () => {
    const c = ctx();
    expect((await runTool(c, "propor_classificacao", JSON.stringify({ codigos: ["#d0d00000"], categoria: "Lazer" }))).output).toMatch(/Não achei a categoria/);
    expect((await runTool(c, "propor_classificacao", JSON.stringify({ codigos: ["#d0d00000"], categoria: "Transporte" }))).output).toMatch(/mais de um/);
    expect((await runTool(c, "propor_classificacao", JSON.stringify({ codigos: ["#ffffffff"], categoria: "Transporte" }))).output).toMatch(/Não achei o lançamento/);
    expect((await runTool(c, "propor_classificacao", JSON.stringify({ loja: "UBERRIDES", categoria: "Transporte", subcategoria: "Trabalho" }))).output).toMatch(/não é subcategoria de Transporte/);
    expect(c.proposals).toEqual([]);
  });

  it("lançar: 'os dois', data de hoje por padrão, valor em centavos", async () => {
    const c = ctx();
    const r = await runTool(c, "propor_lancamento", JSON.stringify({ descricao: "Jantar", valor: 120.5, categoria: "Alimentação", pessoa: "os dois" }));
    expect(r.output).toMatch(/ainda NÃO gravada/);
    expect(c.proposals[0]).toMatchObject({
      kind: "lancar",
      fields: { description: "Jantar", amountCents: 12050, date: "2026-09-26", invoiceMonth: "2026-09", categoryId: ALI, memberId: null, isJoint: true },
      summary: { personLabel: "Os dois" },
    });
  });

  it("lançar RECEITA: o tipo vai na proposta, e a frase para o modelo diz que é receita", async () => {
    const c = ctx();
    const r = await runTool(c, "propor_lancamento", JSON.stringify({ tipo: "receita", descricao: "Salário", valor: 5000, pessoa: "Lari" }));
    expect(r.output).toMatch(/RECEITA Salário/);
    expect(r.output).toMatch(/recebida por Lari/);
    expect(c.proposals[0]).toMatchObject({ kind: "lancar", fields: { type: "income", amountCents: 500000, memberId: LARI } });
  });

  it("a mesma proposta duas vezes na resposta vira uma só (a voz confirma todas de uma vez)", async () => {
    const c = ctx();
    const args = { tipo: "receita", descricao: "FAPESP Lari", valor: 5700, data: "2026-09-04", pessoa: "Lari" };
    await runTool(c, "propor_lancamento", JSON.stringify(args));
    const r2 = await runTool(c, "propor_lancamento", JSON.stringify({ ...args, descricao: " fapesp lari " }));
    const r3 = await runTool(c, "propor_lancamento", JSON.stringify(args));
    expect(r2.output).toMatch(/já está proposto/);
    expect(r3.output).toMatch(/já está proposto/);
    expect(c.proposals).toHaveLength(1);
    // Outro valor, outra data ou despesa: e outra proposta.
    await runTool(c, "propor_lancamento", JSON.stringify({ ...args, valor: 5790 }));
    await runTool(c, "propor_lancamento", JSON.stringify({ ...args, data: "2026-10-04" }));
    await runTool(c, "propor_lancamento", JSON.stringify({ ...args, tipo: "despesa" }));
    expect(c.proposals).toHaveLength(4);
  });

  it("receita escolhe entre as categorias de receita; gasto e orçamento, só entre as de gasto", async () => {
    const BOLSA = "aaaaaaaa-0000-4000-8000-000000000021";
    const c = ctx();
    c.categories = [
      ...CATS,
      { id: BOLSA, houseId: "casa-1", name: "Bolsa", color: "#36f", icon: null, parentId: null, isActive: true, kind: "income" as const, excludedFromTotals: false },
    ] as never;
    await runTool(c, "propor_lancamento", JSON.stringify({ tipo: "receita", descricao: "FAPESP Lari", valor: 5700, categoria: "Bolsa" }));
    expect(c.proposals[0]).toMatchObject({ fields: { type: "income", categoryId: BOLSA }, summary: { categoryLabel: "Bolsa" } });

    // Categoria de gasto numa receita: nao acha, e lista as de receita.
    const r = await runTool(c, "propor_lancamento", JSON.stringify({ tipo: "receita", descricao: "Pix", valor: 10, categoria: "Alimentacao" }));
    expect(r.output).toMatch(/Não achei a categoria de receita "Alimentacao"\. Categorias de receita: Bolsa\./);
    // E o contrario.
    const g = await runTool(c, "propor_lancamento", JSON.stringify({ descricao: "Livro", valor: 10, categoria: "Bolsa" }));
    expect(g.output).toMatch(/Não achei a categoria "Bolsa"/);
    expect(c.proposals).toHaveLength(1);
  });

  it("sem tipo, continua despesa (como antes)", async () => {
    const c = ctx();
    await runTool(c, "propor_lancamento", JSON.stringify({ descricao: "Jantar", valor: 50 }));
    expect(c.proposals[0]).toMatchObject({ fields: { type: "expense" } });
  });

  it("lançar para uma pessoa pelo apelido", async () => {
    const c = ctx();
    await runTool(c, "propor_lancamento", JSON.stringify({ descricao: "Farmácia", valor: 40, pessoa: "Lari", data: "2026-09-25" }));
    expect(c.proposals[0]).toMatchObject({ fields: { memberId: LARI, isJoint: false, categoryId: null } });
  });
});

describe("applyProposal", () => {
  beforeEach(() => {
    db.escritas = [];
    estado.casa = true;
  });

  const classificar = {
    kind: "classificar",
    transactionIds: ["abcd1111-0000-4000-8000-000000000001"],
    categoryId: TRA,
    subcategoryId: UBER,
    learnMerchant: "UBERRIDES",
    learn: true,
  };

  it("sem casa, recusa antes de gravar", async () => {
    estado.casa = false;
    await expect(applyProposal(classificar)).rejects.toThrow();
    expect(db.escritas).toEqual([]);
  });

  it("classifica escopado à casa, e aprende a regra", async () => {
    expect(await applyProposal(classificar)).toEqual({ ok: true, count: 1 });
    const [upd, regra] = db.escritas;
    expect(upd).toMatchObject({ tabela: "transactions", op: "update", payload: { category_id: TRA, subcategory_id: UBER } });
    expect(upd!.filtros).toContainEqual(["eq", "house_id", "casa-1"]);
    expect(regra).toMatchObject({ tabela: "learned_rules", payload: { pattern: "UBERRIDES", category_id: TRA, subcategory_id: UBER } });
  });

  it("com 'aprender' desmarcado, não cria regra", async () => {
    await applyProposal({ ...classificar, learn: false });
    expect(db.escritas.map((e) => e.tabela)).toEqual(["transactions"]);
  });

  it("subcategoria de outra mãe, ou categoria de fora: recusa sem gravar", async () => {
    expect((await applyProposal({ ...classificar, subcategoryId: TRAB })).error).toMatch(/Categoria/);
    expect((await applyProposal({ ...classificar, categoryId: "bbbbbbbb-0000-4000-8000-000000000009", subcategoryId: null })).error).toMatch(/Categoria/);
    // Uma subcategoria no lugar da mae tambem nao passa.
    expect((await applyProposal({ ...classificar, categoryId: UBER, subcategoryId: null })).error).toMatch(/Categoria/);
    expect(db.escritas).toEqual([]);
  });

  const lancar = {
    kind: "lancar",
    fields: {
      description: "Jantar", amountCents: 12050, date: "2026-09-26", invoiceMonth: "2026-09",
      categoryId: ALI, subcategoryId: null, memberId: null, isJoint: true,
    },
  };

  it("lança como manual, confirmado, dos dois", async () => {
    expect(await applyProposal(lancar)).toEqual({ ok: true, count: 1 });
    expect(db.escritas[0]).toMatchObject({
      tabela: "transactions",
      op: "insert",
      payload: { house_id: "casa-1", origin: "manual", status: "confirmed", amount: 120.5, is_joint: true, member_id: null, type: "expense" },
    });
  });

  it("receita entra como receita - não como gasto", async () => {
    expect(await applyProposal({ ...lancar, fields: { ...lancar.fields, type: "income", description: "Salário" } })).toEqual({ ok: true, count: 1 });
    expect(db.escritas[0]).toMatchObject({ tabela: "transactions", op: "insert", payload: { type: "income", description: "Salário" } });
  });

  it("pessoa de fora da casa, ou 'dos dois' com pessoa: recusa", async () => {
    expect((await applyProposal({ ...lancar, fields: { ...lancar.fields, isJoint: false, memberId: "99999999-9999-4999-8999-999999999999" } })).error).toMatch(/não é da casa/);
    expect((await applyProposal({ ...lancar, fields: { ...lancar.fields, memberId: VINI } })).error).toMatch(/dos dois/);
    expect(db.escritas).toEqual([]);
  });

  it("formato estranho não passa", async () => {
    expect((await applyProposal({ kind: "apagar_tudo" })).error).toMatch(/inválida/);
    expect((await applyProposal({ ...lancar, fields: { ...lancar.fields, amountCents: -5 } })).error).toMatch(/inválida/);
  });
});
