import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Transaction } from "@/domain/types";
import type { ChartSpec, Proposal } from "@/domain/chat";

/**
 * Graficos na conversa, e o PDF.
 *
 * O que guarda: os numeros do grafico sao do app (os mesmos totais do
 * Inicio), nunca do texto do modelo; muitas barras viram "Outros"; so o
 * maior e o ultimo mes levam rotulo; o valor aparece ao tocar e na tabela;
 * e exportar imprime so aquela resposta, no tema claro, e devolve o tema.
 */

const ALI = "aaaaaaaa-0000-4000-8000-000000000001";
const TRA = "aaaaaaaa-0000-4000-8000-000000000002";
const CATS = [
  { id: ALI, houseId: "c", name: "Alimentacao", color: "#f00", icon: null, parentId: null, isActive: true, excludedFromTotals: false },
  { id: TRA, houseId: "c", name: "Transporte", color: "#00f", icon: null, parentId: null, isActive: true, excludedFromTotals: false },
];

let n = 0;
const tx = (p: Partial<Transaction>): Transaction =>
  ({
    id: `t${++n}`, houseId: "c", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: "2026-09-10", invoiceMonth: "2026-09", description: "x", merchantOriginal: null,
    merchantNormalized: "LOJA", merchantAlias: null, amount: 100, currency: "BRL", originalAmount: null,
    originalCurrency: null, type: "expense", origin: "invoice", status: "confirmed", categoryId: ALI,
    subcategoryId: null, note: null, receiptUrl: null, visibility: "shared", splitType: "none",
    splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null, calendarEventId: null,
    eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null, createdAt: "", updatedAt: "",
    ...p,
  }) as Transaction;

let LANC: Transaction[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/data/queries", () => ({
  listTransactions: async (_h: string, f: { fromMonth?: string; toMonth?: string }) =>
    LANC.filter((t) => (!f.fromMonth || t.invoiceMonth >= f.fromMonth) && (!f.toMonth || t.invoiceMonth <= f.toMonth)),
}));

const { runTool } = await import("@/lib/chat-tools");
const { ChatChart } = await import("@/components/chat/chat-chart");

const ctx = () => ({
  houseId: "c",
  today: "2026-09",
  todayIso: "2026-09-26",
  members: [],
  categories: CATS,
  excludeCategoryIds: [],
  proposals: [] as Proposal[],
  charts: [] as ChartSpec[],
});

describe("ferramenta grafico", () => {
  beforeEach(() => {
    LANC = [
      tx({ invoiceMonth: "2026-08", amount: 300 }),
      tx({ invoiceMonth: "2026-09", amount: 100 }),
      tx({ invoiceMonth: "2026-09", amount: 50, categoryId: TRA }),
      // Previsao nao entra no realizado.
      tx({ invoiceMonth: "2026-09", amount: 999, status: "forecast" }),
    ];
  });

  it("por mês: os últimos 6, com o total do Início, e o modelo recebe os mesmos números", async () => {
    const c = ctx();
    const r = await runTool(c, "grafico", JSON.stringify({ tipo: "por_mes" }));
    expect(c.charts[0]).toMatchObject({ kind: "colunas", title: "Gasto por mês" });
    expect(c.charts[0]!.points.map((p) => p.label)).toEqual(["abr/26", "mai/26", "jun/26", "jul/26", "ago/26", "set/26"]);
    expect(c.charts[0]!.points.slice(-2).map((p) => p.cents)).toEqual([30_000, 15_000]);
    expect(r.output).toMatch(/- set\/26: R\$\s?150,00/);
  });

  it("por categoria: ordenado, e o que passa de 10 vira Outros", async () => {
    LANC = Array.from({ length: 12 }, (_, i) => tx({ merchantNormalized: `LOJA ${i}`, description: `LOJA ${i}`, amount: 10 * (i + 1) }));
    const c = ctx();
    await runTool(c, "grafico", JSON.stringify({ tipo: "por_loja", de: "2026-09" }));
    const pontos = c.charts[0]!.points;
    expect(pontos).toHaveLength(11);
    expect(pontos[0]).toEqual({ label: "LOJA 11", cents: 12_000 });
    expect(pontos[10]).toEqual({ label: "Outros (2)", cents: 3_000 });
  });

  it("sem gasto no período: não desenha", async () => {
    const c = ctx();
    const r = await runTool(c, "grafico", JSON.stringify({ tipo: "por_categoria", de: "2025-01" }));
    expect(c.charts).toEqual([]);
    expect(r.output).toMatch(/nada para desenhar/);
  });
});

describe("ChatChart", () => {
  const MESES: ChartSpec = {
    id: "g1",
    kind: "colunas",
    title: "Gasto por mês",
    subtitle: "abril a setembro de 2026",
    points: [
      { label: "abr/26", cents: 900_000 },
      { label: "mai/26", cents: 1_210_000 },
      { label: "jun/26", cents: 800_000 },
      { label: "set/26", cents: 1_105_867 },
    ],
  };

  it("rótulo só no maior e no último; o valor aparece ao tocar", () => {
    render(<ChatChart chart={MESES} />);
    expect(screen.getByText("12,1 mil")).toBeTruthy();
    expect(screen.getByText("11,1 mil")).toBeTruthy();
    expect(screen.queryByText("9 mil")).toBeNull();
    const leitura = screen.getByText("Toque numa barra para ver o valor.");
    fireEvent.click(screen.getByRole("listitem", { name: /jun\/26/ }));
    expect(leitura.textContent).toMatch(/R\$\s?8\.000,00 · jun\/26/);
  });

  it("a tabela traz todos os valores", () => {
    render(<ChatChart chart={MESES} printTable />);
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText(/R\$\s?11\.058,67/)).toBeTruthy();
  });
});

describe("Exportar PDF", () => {
  it("imprime só a resposta, no tema claro, e devolve o tema", async () => {
    vi.doMock("@/actions/chat", () => ({
      askHouse: async () => ({
        answer: "Setembro ficou abaixo de agosto.",
        charts: [{ id: "g", kind: "colunas", title: "Gasto por mês", subtitle: "x", points: [{ label: "set/26", cents: 100 }] }],
      }),
      applyProposal: async () => ({}),
    }));
    vi.resetModules();
    const { ChatPanel } = await import("@/components/chat/chat-panel");
    Element.prototype.scrollIntoView = vi.fn();
    window.localStorage.clear();
    const print = vi.fn();
    window.print = print;
    document.documentElement.dataset.theme = "dark";

    const { container } = render(<ChatPanel houseId="c" />);
    fireEvent.change(screen.getByLabelText("Pergunta"), { target: { value: "compara os meses" } });
    fireEvent.keyDown(screen.getByLabelText("Pergunta"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: /Exportar PDF/ }));

    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(document.documentElement.dataset.theme).toBe("light");
    const bloco = container.querySelector(".so-impressao")!;
    expect(bloco.textContent).toMatch(/compara os meses/);
    expect(bloco.textContent).toMatch(/Setembro ficou abaixo de agosto/);

    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(container.querySelector(".so-impressao")).toBeNull();
  });
});
