import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Importacao com lancamentos do mes (provisorios).
 *
 * O que guarda: a padaria lancada pela conversa no dia 15 e a linha da fatura
 * que chega depois sao uma compra so. A revisao mostra o par e usa a
 * categoria que a casa deu (sem perguntar ao Jev); a gravacao poe a linha do
 * banco no lugar, com a nota e o "dos dois", e tira o provisorio das contas;
 * desfazer a importacao devolve o provisorio.
 */

const ALI = "00000000-0000-4000-8000-000000000003";
const CARTAO = "00000000-0000-4000-8000-00000000000c";
const PROV = "00000000-0000-4000-8000-0000000000a1";

const LAZ = "00000000-0000-4000-8000-000000000004";
const CATEGORIAS = [
  { id: ALI, name: "Alimentacao", parent_id: null },
  { id: LAZ, name: "Lazer", parent_id: null },
];

/** O que a conversa lancou no dia 15: sem cartao, com nota, "dos dois". */
const PROVISORIO = {
  id: PROV,
  date: "2026-09-15",
  amount: 40,
  type: "expense",
  card_id: null,
  description: "padaria",
  merchant_alias: null,
  installment_current: null,
  installment_total: null,
  category_id: ALI,
  subcategory_id: null,
  note: "pão de sábado",
  member_id: null,
  is_joint: true,
  visibility: "shared",
};

type Chamada = { tabela: string; operacao: string; payload: unknown; filtros: [string, unknown][] };

const estado = {
  chamadas: [] as Chamada[],
  provisorios: [PROVISORIO] as Record<string, unknown>[],
  daFatura: [] as Record<string, unknown>[],
};

type Resultado = { data: unknown; error: null; count?: number };

function tabela(nome: string) {
  const chamada: Chamada = { tabela: nome, operacao: "select", payload: null, filtros: [] };
  let colunas = "";
  const resolver = (): Resultado => {
    estado.chamadas.push(chamada);
    const { operacao, payload } = chamada;
    if (operacao === "insert" && nome === "invoices") return { data: { id: "fatura-1" }, error: null };
    if (operacao === "insert" && nome === "cards") {
      const novos = payload as { last_four: string }[];
      return { data: novos.map((c) => ({ id: `cartao-${c.last_four}`, last_four: c.last_four })), error: null };
    }
    if (operacao !== "select") return { data: null, error: null, count: 1 };
    if (nome === "categories") return { data: CATEGORIAS, error: null };
    if (nome === "transactions" && colunas.includes("reconciled_with_id")) return { data: estado.daFatura, error: null };
    // Os provisorios: a busca da revisao (por data) e a conferencia do commit (por id).
    if (nome === "transactions" && chamada.filtros.some(([f]) => f === "is:invoice_id")) {
      return { data: estado.provisorios, error: null };
    }
    void payload;
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "gte", "lte", "order", "range", "limit", "single", "maybeSingle"]) {
    b[m] = (campo: string, valor: unknown) => {
      chamada.filtros.push([`${m}:${campo}`, valor]);
      return b;
    };
  }
  b.select = (c?: string) => {
    if (chamada.operacao === "select") colunas = c ?? "";
    return b;
  };
  for (const op of ["insert", "update", "upsert", "delete"]) {
    b[op] = (p: unknown) => {
      chamada.operacao = op;
      chamada.payload = p;
      return b;
    };
  }
  b.then = (ok: (r: Resultado) => unknown) => Promise.resolve(resolver()).then(ok);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => "sk-or-da-casa" }));
vi.mock("@/lib/ai-usage", () => ({ recordAiUsage: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));

const { reviewImport, commitImport, revertImport } = await import("@/actions/import");

function rascunho(row: number, merchant: string, extra: Record<string, unknown> = {}) {
  return {
    row,
    date: "2026-09-16",
    invoiceMonth: "2026-09",
    description: merchant,
    merchantOriginal: merchant,
    merchantNormalized: merchant,
    amountCents: 3_990,
    type: "expense",
    categoryHint: null,
    categoryId: null,
    cardLastFour: null,
    cardId: CARTAO,
    installmentCurrent: null,
    installmentTotal: null,
    duplicateKey: `k${row}`,
    ...extra,
  };
}

const operacoes = (tabelaNome: string, op: string) =>
  estado.chamadas.filter((c) => c.tabela === tabelaNome && c.operacao === op);

beforeEach(() => {
  estado.chamadas.length = 0;
  estado.provisorios = [PROVISORIO];
  estado.daFatura = [];
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
});

describe("revisão", () => {
  it("acha a compra já lançada e usa a categoria da casa, sem perguntar ao Jev", async () => {
    const r = await reviewImport({
      drafts: [rascunho(1, "PADARIA DO ZE LTDA"), rascunho(2, "LOJA QUALQUER", { amountCents: 25_000 })],
      invoiceMonth: "2026-09",
      cardId: CARTAO,
      memberId: null,
    });
    const [padaria, posto] = r.reviewed!;
    expect(padaria).toMatchObject({
      decision: "new",
      categoryId: ALI,
      provisorio: { id: PROV, texto: "padaria", date: "2026-09-15", amountCents: 4_000 },
    });
    expect(posto!.provisorio).toBeUndefined();
    expect(r.notes!.join(" ")).toMatch(/1 compra\(s\) já lançada\(s\) durante o mês/);
    // So o posto foi ao Jev: a padaria ja tinha categoria da casa.
    const enviados = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[1]?.body ?? "")).join("\n");
    expect(enviados).toMatch(/LOJA QUALQUER/);
    expect(enviados).not.toMatch(/PADARIA/);
  });
});

describe("gravação", () => {
  const base = { invoiceMonth: "2026-09", cardId: CARTAO, memberId: null, fileName: "f.csv", fileHash: null, institution: null, format: "csv", reportedTotalCents: null };
  const provisorio = { id: PROV, texto: "padaria", date: "2026-09-15", amountCents: 4_000 };

  it("a linha do banco fica no lugar, com o que a casa decidiu; o provisório sai das contas", async () => {
    const r = await commitImport({
      ...base,
      drafts: [
        rascunho(1, "PADARIA DO ZE LTDA", { categoryId: ALI, decision: "new", provisorio }),
        rascunho(2, "POSTO SHELL", { amountCents: 25_000, decision: "new" }),
      ],
    });
    expect(r.error).toBeUndefined();

    const [insert] = operacoes("transactions", "insert");
    const linhas = insert!.payload as Record<string, unknown>[];
    expect(linhas[0]).toMatchObject({
      description: "PADARIA DO ZE LTDA",
      amount: 39.9,
      reconciled_with_id: PROV,
      category_id: ALI,
      category_source: "casa",
      note: "pão de sábado",
      is_joint: true,
      member_id: null,
    });
    expect(linhas[1]).toMatchObject({ reconciled_with_id: null, is_joint: false, note: null });
    // Insert em lote: toda linha com as mesmas colunas, ou a que falta vira nulo.
    expect(Object.keys(linhas[0]!).sort()).toEqual(Object.keys(linhas[1]!).sort());

    const [update] = operacoes("transactions", "update");
    expect(update!.payload).toEqual({ status: "cancelled", is_reconciled: true });
    expect(update!.filtros).toContainEqual(["in:id", [PROV]]);
    expect(update!.filtros).toContainEqual(["eq:house_id", "casa-1"]);
  });

  it("provisório que já não espera a fatura (ou de outra casa) não é usado", async () => {
    estado.provisorios = [];
    await commitImport({
      ...base,
      drafts: [rascunho(1, "PADARIA DO ZE LTDA", { categoryId: ALI, decision: "new", provisorio })],
    });
    const [insert] = operacoes("transactions", "insert");
    expect((insert!.payload as Record<string, unknown>[])[0]).toMatchObject({ reconciled_with_id: null, note: null });
    expect(operacoes("transactions", "update")).toHaveLength(0);
  });

  it("'São compras diferentes': sem provisório, as duas ficam", async () => {
    await commitImport({
      ...base,
      drafts: [rascunho(1, "PADARIA DO ZE LTDA", { categoryId: ALI, decision: "new", provisorio: null })],
    });
    expect(operacoes("transactions", "update")).toHaveLength(0);
  });
});

describe("cartão novo na fatura", () => {
  it("a importação devolve os cartões que criou, para a tela pedir o nome", async () => {
    estado.provisorios = [];
    const r = await commitImport({
      invoiceMonth: "2026-09",
      cardId: null,
      memberId: null,
      fileName: "f.csv",
      fileHash: null,
      institution: null,
      format: "csv",
      reportedTotalCents: null,
      drafts: [rascunho(1, "POSTO SHELL", { cardId: null, cardLastFour: "2150", decision: "new" })],
    });
    expect(r.error).toBeUndefined();
    expect(r.cartoesNovos).toEqual([{ id: "cartao-2150", lastFour: "2150" }]);
    const [criacao] = operacoes("cards", "insert");
    expect(criacao!.payload).toEqual([{ house_id: "casa-1", name: "Cartão 2150", last_four: "2150" }]);
  });
});

describe("desfazer", () => {
  it("devolve às contas o lançamento do mês que a fatura tinha substituído", async () => {
    estado.daFatura = [{ reconciled_with_id: PROV }, { reconciled_with_id: null }];
    const r = await revertImport("fatura-1");
    expect(r.error).toBeUndefined();
    const [update] = operacoes("transactions", "update");
    expect(update!.payload).toEqual({ status: "confirmed", is_reconciled: false });
    expect(update!.filtros).toContainEqual(["in:id", [PROV]]);
  });
});
