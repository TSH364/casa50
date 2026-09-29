import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkOffers, installmentPlan, normalizeUrl, offersFromCitations, purchaseImpact, storeFromUrl } from "@/domain/shopping";
import type { ShoppingSearch } from "@/domain/shopping";
import type { ChartSpec, Proposal } from "@/domain/chat";
import type { Transaction } from "@/domain/types";

/**
 * A pesquisa de compra da Conversa.
 *
 * O que guarda: so vai para a tela link de pagina que a busca abriu; o preco
 * e conferido contra o trecho da pagina; a busca leva so o produto (nada da
 * casa) e usa provedor que nao guarda; o gasto e anotado como "pesquisa";
 * a simulacao soma a parcela nova as ja assumidas; e "criar tarefa" cai na
 * primeira coluna do quadro - criando o quadro se ainda nao existe.
 */

const ML = "https://produto.mercadolivre.com.br/MLB-123-air-fryer-mondial-4l";
const AMZ = "https://www.amazon.com.br/dp/B0ABC";
const citacoes = [
  { url: ML, title: "Air Fryer Mondial 4L", content: "Por R$ 349,90 em até 10x de R$ 34,99 sem juros" },
  { url: AMZ, title: "Fritadeira Philco", content: "Oferta do dia" },
];
const resposta = (ofertas: unknown[]) => "```json\n" + JSON.stringify({ ofertas }) + "\n```";

describe("checkOffers", () => {
  it("só link visitado; o link da tela é o da citação; loja pelo endereço; mais barata primeiro", () => {
    const r = checkOffers(
      resposta([
        { titulo: "Fritadeira Philco 4L", loja: "amazon", preco: 299, url: `${AMZ}?tag=x#top` },
        { titulo: "Air Fryer Mondial 4L", loja: "ML", preco: "R$ 349,90", parcelamento: "10x de R$ 34,99", url: `${ML}/` },
        { titulo: "Inventada", loja: "Loja X", preco: 99, url: "https://lojax.com.br/air-fryer" },
        { titulo: "Perigosa", loja: "X", preco: 10, url: "javascript:alert(1)" },
      ]),
      citacoes,
      null,
    );
    expect(r.dropped).toBe(2);
    expect(r.offers.map((o) => [o.store, o.priceCents, o.url])).toEqual([
      ["Amazon", 29_900, AMZ],
      ["Mercado Livre", 34_990, ML],
    ]);
    // O preco da Mondial esta no trecho; o da Philco nao.
    expect(r.offers.map((o) => o.priceSeen)).toEqual([false, true]);
    expect(r.offers[1]!.installments).toBe("10x de R$ 34,99");
  });

  it("acima do teto fica de fora; resposta que não é JSON não vira oferta", () => {
    expect(checkOffers(resposta([{ titulo: "Air Fryer", preco: 349.9, url: ML }]), citacoes, 30_000).offers).toEqual([]);
    expect(checkOffers("não achei nada", citacoes, null)).toEqual({ offers: [], dropped: 0 });
  });

  it("endereço comparável e nome de loja", () => {
    expect(normalizeUrl("https://www.Amazon.com.br/dp/B0ABC/?ref=1")).toBe("amazon.com.br/dp/B0ABC");
    expect(normalizeUrl("ftp://x.com/a")).toBeNull();
    expect(storeFromUrl("https://www.magazineluiza.com.br/x", "")).toBe("Magalu");
    expect(storeFromUrl("https://lojinha.com.br/x", "Lojinha")).toBe("Lojinha");
  });
});

describe("mesmo produto, endereços diferentes", () => {
  it("Mercado Livre pelo código MLB; Amazon pelo ASIN", () => {
    const cit = [
      { url: "https://www.mercadolivre.com.br/fechadura-tapo-dl110/p/MLB23456789", title: "Fechadura Tapo DL110", content: "R$ 899,00" },
      { url: "https://www.amazon.com.br/Fechadura-Tapo/dp/B0CXYZ1234/ref=sr_1", title: "Tapo", content: "" },
    ];
    const r = checkOffers(
      resposta([
        { titulo: "Fechadura Tapo DL110", preco: 899, url: "https://produto.mercadolivre.com.br/MLB-23456789-fechadura-tapo-_JM" },
        { titulo: "Fechadura Tapo", preco: 949, url: "https://amazon.com.br/dp/B0CXYZ1234" },
      ]),
      cit,
      null,
    );
    expect(r.offers.map((o) => o.url)).toEqual([cit[0]!.url, cit[1]!.url]);
    expect(r.offers[0]!.priceSeen).toBe(true);
  });
});

describe("plano B: ofertas direto das páginas citadas", () => {
  it("só loja conhecida, com preço no trecho; blog e redirecionamento ficam de fora", () => {
    const r = offersFromCitations(
      [
        { url: "https://www.magazineluiza.com.br/fechadura-tapo/p/abc123/", title: "Fechadura Digital Tapo DL100", content: "R$ 1.099,90 ou 10x de R$ 109,99 sem juros" },
        { url: "https://blog.exemplo.com.br/melhores-fechaduras", title: "As melhores", content: "a partir de R$ 300" },
        { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz", title: "amazon.com.br", content: "R$ 999" },
        { url: "https://www.kabum.com.br/produto/1", title: "Fechadura sem preço", content: "Indisponível" },
      ],
      null,
    );
    expect(r).toEqual([
      {
        title: "Fechadura Digital Tapo DL100",
        store: "Magalu",
        priceCents: 109_990,
        installments: "10x de R$ 109,99 sem juros",
        url: "https://www.magazineluiza.com.br/fechadura-tapo/p/abc123/",
        priceSeen: true,
      },
    ]);
  });
});

describe("simulação", () => {
  it("parcelas somam o total, com a sobra na primeira; primeira na próxima fatura", () => {
    expect(installmentPlan(34_990, 3)).toEqual([11_664, 11_663, 11_663]);
    const m = purchaseImpact(34_990, 2, "2026-09", new Map([["2026-10", 120_000]]));
    expect(m).toEqual([
      { month: "2026-10", committedCents: 120_000, newCents: 17_495 },
      { month: "2026-11", committedCents: 0, newCents: 17_495 },
    ]);
  });
});

// ---------------------------------------------------------------------------

const ALI = "aaaaaaaa-0000-4000-8000-000000000001";
const CASA = "aaaaaaaa-0000-4000-8000-000000000002";
const CATS = [
  { id: ALI, houseId: "casa-1", name: "Alimentacao", color: "#f00", icon: null, parentId: null, isActive: true, excludedFromTotals: false },
  { id: CASA, houseId: "casa-1", name: "Casa", color: "#00f", icon: null, parentId: null, isActive: true, excludedFromTotals: false },
];

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(16).slice(2), houseId: "casa-1", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: "2026-09-10", invoiceMonth: "2026-09", description: "x", merchantOriginal: null,
    merchantNormalized: null, merchantAlias: null, amount: 100, currency: "BRL", originalAmount: null,
    originalCurrency: null, type: "expense", origin: "invoice", status: "confirmed", categoryId: null,
    subcategoryId: null, note: null, receiptUrl: null, visibility: "shared", splitType: "none",
    splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null, calendarEventId: null,
    eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null, createdAt: "", updatedAt: "",
    ...p,
  } as Transaction;
}

const estado = {
  corpos: [] as Record<string, unknown>[],
  usos: [] as unknown[][],
  escritas: [] as { tabela: string; op: string; payload: unknown }[],
  colunas: [] as { id: string; position: number }[],
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/ai-usage", () => ({ recordAiUsage: async (...a: unknown[]) => estado.usos.push(a) }));
vi.mock("@/lib/houses", () => ({ listMembers: async () => [] }));
vi.mock("@/data/queries", () => ({
  listTransactions: async (_h: string, f: { fromMonth?: string }) =>
    f.fromMonth === "2026-10"
      ? [tx({ invoiceMonth: "2026-10", amount: 1200, installment: { current: 2, total: 5, value: 1200 } })]
      : [
          tx({ invoiceMonth: "2026-06", amount: 3000 }),
          tx({ invoiceMonth: "2026-07", amount: 4000 }),
          tx({ invoiceMonth: "2026-08", amount: 5000 }),
          tx({ invoiceMonth: "2026-09", amount: 150, categoryId: CASA }),
        ],
  listBudgets: async () => [{ id: "b", houseId: "casa-1", categoryId: CASA, month: "2026-09", limitAmount: 400 }],
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({
    from: (nome: string) => {
      let op = "select";
      let payload: unknown;
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "in"]) b[m] = () => b;
      for (const m of ["insert", "update"]) b[m] = (p: unknown) => { op = m; payload = p; return b; };
      b.then = (ok: (r: unknown) => unknown) => {
        if (op !== "select") estado.escritas.push({ tabela: nome, op, payload });
        let data: unknown = [];
        if (nome === "task_lists" && op === "select") data = estado.colunas;
        if (nome === "task_lists" && op === "insert") data = (payload as { position: number }[]).map((c, i) => ({ id: `nova-${i}`, position: c.position }));
        return Promise.resolve({ data, error: null }).then(ok);
      };
      return b;
    },
  }),
}));

const { runTool } = await import("@/lib/chat-tools");
const { applyProposal } = await import("@/actions/chat");

const ctx = () => ({
  houseId: "casa-1",
  today: "2026-09",
  todayIso: "2026-09-29",
  members: [{ userId: "v", fullName: "Vinicius Roselli", email: "vini@exemplo.com", role: "owner" as const }],
  categories: CATS,
  excludeCategoryIds: [],
  proposals: [] as Proposal[],
  charts: [] as ChartSpec[],
  searches: [] as ShoppingSearch[],
  apiKey: "sk-or-da-casa",
});

describe("pesquisar_compra", () => {
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => {
    estado.corpos = [];
    estado.usos = [];
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      estado.corpos.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          model: "google/gemini-3.6-flash",
          usage: { cost: 0.021 },
          choices: [
            {
              message: {
                content: resposta([{ titulo: "Air Fryer Mondial 4L", loja: "ML", preco: 349.9, url: ML }]),
                annotations: citacoes.map((c) => ({ type: "url_citation", url_citation: c })),
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
  });

  it("só o produto sai; busca na web sem guarda de dados; cartão com a oferta; gasto como 'pesquisa'", async () => {
    const c = ctx();
    const r = await runTool(c, "pesquisar_compra", JSON.stringify({ produto: "air fryer 4 litros", preco_maximo: 400 }));
    globalThis.fetch = fetchOriginal;

    const corpo = estado.corpos[0]!;
    expect(corpo.plugins).toEqual([{ id: "web", engine: "exa", max_results: 8 }]);
    expect(corpo.provider).toEqual({ data_collection: "deny" });
    const pedido = JSON.stringify(corpo.messages);
    expect(pedido).toMatch(/air fryer 4 litros/);
    expect(pedido).toMatch(/R\$ 400,00/);
    expect(pedido).not.toMatch(/Vinicius|vini@|Alimentacao|casa-1/);

    expect(c.searches).toHaveLength(1);
    expect(c.searches[0]!.offers[0]).toMatchObject({ store: "Mercado Livre", priceCents: 34_990, url: ML, priceSeen: true });
    expect(r.output).toMatch(/Mercado Livre — Air Fryer Mondial 4L — R\$\s*349,90 à vista/);
    expect(estado.usos[0]).toEqual(["casa-1", "pesquisa", { calls: 1, costUsd: 0.021, model: "google/gemini-3.6-flash" }]);
  });

  it("sem tempo até o prazo da pergunta, não pesquisa", async () => {
    const c = { ...ctx(), deadline: Date.now() + 15_000 };
    const r = await runTool(c, "pesquisar_compra", JSON.stringify({ produto: "fechadura" }));
    globalThis.fetch = fetchOriginal;
    expect(estado.corpos).toHaveLength(0);
    expect(r.output).toMatch(/Não há tempo para pesquisar/);
  });

  it("a IA errou os links: as ofertas saem das páginas de loja citadas", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: resposta([{ titulo: "Air Fryer", preco: 349.9, url: "https://lojainventada.com/x" }]),
                annotations: citacoes.map((c) => ({ type: "url_citation", url_citation: c })),
              },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    const c = ctx();
    await runTool(c, "pesquisar_compra", JSON.stringify({ produto: "air fryer" }));
    globalThis.fetch = fetchOriginal;
    expect(c.searches[0]!.offers.map((o) => [o.store, o.priceCents])).toEqual([["Mercado Livre", 34_990]]);
  });

  it("no máximo duas pesquisas por pergunta", async () => {
    const c = ctx();
    for (let i = 0; i < 3; i += 1) await runTool(c, "pesquisar_compra", JSON.stringify({ produto: `produto ${i}` }));
    globalThis.fetch = fetchOriginal;
    expect(estado.corpos).toHaveLength(2);
    expect(c.searches).toHaveLength(2);
  });
});

describe("simular_compra", () => {
  it("parcela nova somada às assumidas, média dos meses fechados e orçamento da categoria", async () => {
    const r = await runTool(ctx(), "simular_compra", JSON.stringify({ valor: 349.9, parcelas: 2, categoria: "Casa" }));
    expect(r.output).toMatch(/2x de R\$\s*174,95/);
    expect(r.output).toMatch(/Gasto médio dos últimos 3 meses fechados: R\$\s*4\.000,00/);
    expect(r.output).toMatch(/outubro de 2026: R\$\s*1\.200,00 \+ R\$\s*174,95 = R\$\s*1\.374,95/);
    expect(r.output).toMatch(/Orçamento de Casa .*gasto R\$\s*150,00 de R\$\s*400,00, livre R\$\s*250,00/);
    expect(r.output).toMatch(/primeira parcela \(R\$\s*174,95\) cabe/);
  });
});

describe("propor_tarefa e applyProposal('tarefa')", () => {
  beforeEach(() => {
    estado.escritas = [];
  });

  it("a ferramenta só propõe", async () => {
    const c = ctx();
    await runTool(c, "propor_tarefa", JSON.stringify({ titulo: "Comprar air fryer", valor_previsto: 349.9 }));
    expect(c.proposals[0]).toMatchObject({ kind: "tarefa", fields: { title: "Comprar air fryer", expectedCents: 34_990 } });
    expect(estado.escritas).toHaveLength(0);
  });

  it("na primeira coluna existente, com o previsto em reais", async () => {
    estado.colunas = [{ id: "col-1", position: 0 }];
    const r = await applyProposal({ kind: "tarefa", fields: { title: "Comprar air fryer", expectedCents: 34_990, notes: ML } });
    expect(r.ok).toBe(true);
    expect(estado.escritas).toEqual([
      {
        tabela: "tasks",
        op: "insert",
        payload: expect.objectContaining({ house_id: "casa-1", list_id: "col-1", title: "Comprar air fryer", expected_amount: 349.9, notes: ML }),
      },
    ]);
  });

  it("sem quadro, cria as colunas de partida e usa a primeira", async () => {
    estado.colunas = [];
    await applyProposal({ kind: "tarefa", fields: { title: "Comprar air fryer", expectedCents: null, notes: null } });
    expect(estado.escritas.map((e) => e.tabela)).toEqual(["task_lists", "tasks"]);
    expect(estado.escritas[1]!.payload).toMatchObject({ list_id: "nova-0", expected_amount: null });
  });
});
