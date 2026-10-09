import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { buildInsights, type Insight } from "@/domain/insights";
import { categoryMatrix } from "@/domain/finance";
import type { Category, Transaction } from "@/domain/types";

/**
 * Analise do mes, a parte visual - pedido da casa: "melhore a parte visual
 * das analises do mes".
 *
 * O que guarda: cada comparacao leva os dois numeros que a barra desenha (o
 * mes e a referencia); a diferenca vem escrita, nunca so na cor; as
 * observacoes se agrupam em "pede atencao" e "boas noticias"; e a matriz
 * vira uma linha por categoria, com o mes em foco dizendo se saiu do usual
 * - a tabela continua, recolhida.
 */

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  seq += 1;
  return {
    id: `t${seq}`, houseId: "c", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: `${p.invoiceMonth ?? "2026-09"}-05`, invoiceMonth: "2026-09", description: "Compra",
    merchantOriginal: null, merchantNormalized: null, merchantAlias: null, amount: 100, currency: "BRL",
    originalAmount: null, originalCurrency: null, type: "expense", origin: "manual", status: "confirmed",
    categoryId: null, subcategoryId: null, note: null, receiptUrl: null, visibility: "shared",
    splitType: "none", splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null,
    calendarEventId: null, eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null,
    createdAt: "", updatedAt: "", ...p,
  };
}
const cat = (id: string, name: string): Category => ({
  id, houseId: "c", name, color: "#4f8cff", icon: null, parentId: null, isActive: true, kind: "expense",
} as Category);

const categorias = [cat("res", "Restaurantes"), cat("mer", "Mercado")];
const historico = [
  ...["2026-07", "2026-08", "2026-09"].map((m) => tx({ invoiceMonth: m, categoryId: "res", amount: 810 })),
  tx({ invoiceMonth: "2026-10", categoryId: "res", amount: 1120 }),
  ...["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => tx({ invoiceMonth: m, categoryId: "mer", amount: m === "2026-10" ? 1812.4 : 1400 })),
];

describe("os números da barra", () => {
  const insights = buildInsights({
    month: "2026-10",
    transactions: historico,
    categories: categorias,
    budgets: [{ id: "b", houseId: "c", categoryId: "mer", month: "2026-10", limitAmount: 1500 }],
    recurrenceMatches: [],
  });

  it("categoria acima da média: o mês contra a média", () => {
    const spike = insights.find((i) => i.kind === "category_spike")!;
    expect(spike.medida).toEqual({ atualCents: 112_000, atualRotulo: "Neste mês", referenciaCents: 81_000, referenciaRotulo: "média" });
  });

  it("orçamento estourado: o gasto contra o limite", () => {
    const over = insights.find((i) => i.kind === "budget_over")!;
    expect(over.medida).toMatchObject({ atualCents: 181_240, referenciaCents: 150_000, referenciaRotulo: "limite" });
  });
});

const nbsp = (s: string | null) => (s ?? "").replace(/\s/g, " ");

const exemplo = (p: Partial<Insight>): Insight => ({
  id: "x", kind: "category_spike", tone: "attention", title: "Restaurantes acima da média", detail: "Gasto 38% maior.",
  evidence: [{ label: "Neste mês", value: "R$ 1.120,00" }],
  medida: { atualCents: 112_000, atualRotulo: "Neste mês", referenciaCents: 81_000, referenciaRotulo: "média" },
  weight: 1, ...p,
});

describe("o cartão da observação", () => {
  it("com medida: a diferença escrita e os dois valores; sem medida: a evidência", async () => {
    const { InsightCard } = await import("@/components/insights/insight-card");
    const { container, rerender } = render(<ul><InsightCard insight={exemplo({})} /></ul>);
    expect(nbsp(container.textContent)).toContain("+R$ 310,00 · 38%");
    expect(nbsp(container.textContent)).toContain("média R$ 810,00");
    expect(nbsp(screen.getByRole("img").getAttribute("aria-label"))).toBe("Neste mês: R$ 1.120,00; média: R$ 810,00");

    rerender(
      <ul>
        <InsightCard insight={exemplo({ kind: "budget_over", tone: "danger", medida: { atualCents: 181_240, atualRotulo: "Gasto", referenciaCents: 150_000, referenciaRotulo: "limite" } })} />
      </ul>,
    );
    expect(container.textContent).toContain("121% do limite");

    rerender(<ul><InsightCard insight={exemplo({ kind: "installments_ending", tone: "positive", medida: undefined, evidence: [{ label: "Sofá", value: "R$ 220,00/mês" }] })} /></ul>);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Sofá")).toBeTruthy();
  });

  it("agrupa em pede atenção e boas notícias, com a contagem", async () => {
    const { InsightsDoMes } = await import("@/components/insights/insights-do-mes");
    const { rerender } = render(
      <InsightsDoMes insights={[exemplo({ id: "a" }), exemplo({ id: "b", tone: "danger" }), exemplo({ id: "c", tone: "positive", title: "Transporte abaixo" })]} />,
    );
    const atencao = screen.getByRole("region", { name: /Pede atenção/ });
    expect(within(atencao).getAllByRole("listitem")).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: /Boas notícias/ })).getByText("Transporte abaixo")).toBeTruthy();

    // Um grupo so, sem titulo.
    rerender(<InsightsDoMes insights={[exemplo({ id: "a" })]} />);
    expect(screen.queryByText("Pede atenção")).toBeNull();
  });
});

describe("mês a mês, por categoria", () => {
  const meses = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const txs = meses.flatMap((m) => [
    tx({ invoiceMonth: m, categoryId: "res", amount: m === "2026-10" ? 1500 : 800 }),
    tx({ invoiceMonth: m, categoryId: "mer", amount: 1000 }),
  ]);

  it("a mediana de cada categoria sai junto", () => {
    const mx = categoryMatrix(txs, meses);
    expect(mx.categoryIds).toEqual(["mer", "res"]);
    expect(mx.categoryMedians).toEqual([100_000, 80_000]);
  });

  it("uma linha por categoria; o mês fora do usual vem escrito; a tabela continua recolhida", async () => {
    vi.doMock("@/data/queries", () => ({ listTransactions: async () => txs, listCategories: async () => categorias }));
    vi.resetModules();
    const { CategoryMatrix } = await import("@/components/dashboard/category-matrix");
    render(await CategoryMatrix({ houseId: "c", month: "2026-10", excludeCategoryIds: [] }));
    const linha = (nome: string) => screen.getAllByText(nome).map((e) => e.closest("li")).find(Boolean)!;
    expect(within(linha("Restaurantes")).getByText("▲ acima")).toBeTruthy();
    expect(within(linha("Mercado")).getByText("no usual")).toBeTruthy();
    expect(nbsp(within(linha("Restaurantes")).getByText(/usual R\$/).textContent)).toBe("usual R$ 800");
    expect(screen.getByText("Ver a tabela mês a mês").closest("details")?.querySelector("table")).toBeTruthy();
    vi.doUnmock("@/data/queries");
  });
});
