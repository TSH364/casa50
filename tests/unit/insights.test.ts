import { describe, expect, it } from "vitest";
import { buildInsights, historyDepth } from "@/domain/insights";
import type { Budget, Category, Transaction } from "@/domain/types";
import type { RecurrenceMatch } from "@/domain/forecast";

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    houseId: "casa",
    invoiceId: null,
    cardId: null,
    memberId: null,
    date: "2026-08-10",
    invoiceMonth: "2026-08",
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
    isHidden: false,
    isReconciled: false,
    createdBy: null,
    createdAt: "2026-08-10T00:00:00Z",
    updatedAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

const MERCADO: Category = {
  id: "cat-mercado",
  houseId: "casa",
  name: "Mercado",
  color: "#8FBF6A",
  icon: null,
  parentId: null,
  isActive: true,
};

/** Mesma formatacao que os insights usam, para a asercao nao depender de
 *  qual espaco o Intl escolhe entre "R$" e o numero. */
function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const base = {
  month: "2026-08" as const,
  categories: [MERCADO],
  budgets: [] as Budget[],
  recurrenceMatches: [] as RecurrenceMatch[],
};

/** Gasto de um mês inteiro numa categoria. */
function mes(month: string, amount: number, categoryId: string | null = MERCADO.id) {
  return tx({ invoiceMonth: month, date: `${month}-10`, amount, categoryId });
}

describe("buildInsights — silêncio sem base", () => {
  it("não gera nada com um mês só", () => {
    // Comparar o primeiro mês de uso com nada seria inventar anomalia.
    const insights = buildInsights({ ...base, transactions: [mes("2026-08", 800)] });
    expect(insights).toHaveLength(0);
  });

  it("não gera nada sem lançamento algum", () => {
    expect(buildInsights({ ...base, transactions: [] })).toHaveLength(0);
  });
});

describe("buildInsights — comparação por categoria", () => {
  it("acusa categoria acima da média", () => {
    const insights = buildInsights({
      ...base,
      transactions: [
        mes("2026-05", 400),
        mes("2026-06", 400),
        mes("2026-07", 400),
        mes("2026-08", 900),
      ],
    });

    const spike = insights.find((i) => i.kind === "category_spike");
    expect(spike).toBeDefined();
    expect(spike?.title).toContain("Mercado");
  });

  it("sempre carrega a evidência numérica", () => {
    // Exigência central da secao 14: nunca só a conclusão.
    const insights = buildInsights({
      ...base,
      transactions: [
        mes("2026-06", 400),
        mes("2026-07", 400),
        mes("2026-08", 900),
      ],
    });

    for (const insight of insights) {
      expect(insight.evidence.length).toBeGreaterThan(0);
      for (const e of insight.evidence) {
        expect(e.label).not.toBe("");
        expect(e.value).not.toBe("");
      }
    }
  });

  it("reconhece queda como notícia boa", () => {
    const insights = buildInsights({
      ...base,
      transactions: [
        mes("2026-06", 900),
        mes("2026-07", 900),
        mes("2026-08", 300),
      ],
    });

    const drop = insights.find((i) => i.kind === "category_drop");
    expect(drop?.tone).toBe("positive");
  });

  it("ignora variação grande em valor irrelevante", () => {
    // Triplicar R$ 10 não merece um aviso na tela.
    const insights = buildInsights({
      ...base,
      transactions: [
        mes("2026-06", 10),
        mes("2026-07", 10),
        mes("2026-08", 30),
      ],
    });
    expect(insights.filter((i) => i.kind === "category_spike")).toHaveLength(0);
  });
});

describe("buildInsights — orçamento", () => {
  const orcamento: Budget = {
    id: "b1",
    houseId: "casa",
    categoryId: MERCADO.id,
    month: "2026-08",
    limitAmount: 500,
  };

  it("avisa quando estoura", () => {
    const insights = buildInsights({
      ...base,
      budgets: [orcamento],
      transactions: [mes("2026-08", 620)],
    });

    const over = insights.find((i) => i.kind === "budget_over");
    expect(over?.tone).toBe("danger");
    expect(over?.evidence).toContainEqual({ label: "Passou", value: brl(120) });
  });

  it("avisa a partir de 80% do limite", () => {
    const insights = buildInsights({
      ...base,
      budgets: [orcamento],
      transactions: [mes("2026-08", 420)],
    });
    expect(insights.find((i) => i.kind === "budget_warning")).toBeDefined();
  });

  it("fica calado dentro do limite", () => {
    const insights = buildInsights({
      ...base,
      budgets: [orcamento],
      transactions: [mes("2026-08", 200)],
    });
    expect(insights.filter((i) => i.kind.startsWith("budget"))).toHaveLength(0);
  });

  it("estouro vem antes de tudo na ordenação", () => {
    const insights = buildInsights({
      ...base,
      budgets: [orcamento],
      transactions: [
        mes("2026-06", 400),
        mes("2026-07", 400),
        mes("2026-08", 900),
      ],
    });
    expect(insights[0]?.kind).toBe("budget_over");
  });
});

describe("buildInsights — parcelas acabando", () => {
  it("avisa quanto será liberado por mês", () => {
    const insights = buildInsights({
      ...base,
      transactions: [
        mes("2026-07", 100),
        tx({
          invoiceMonth: "2026-08",
          amount: 300,
          merchantNormalized: "SOFA",
          description: "Sofá",
          installment: { current: 5, total: 6, value: 300 },
        }),
      ],
    });

    const ending = insights.find((i) => i.kind === "installments_ending");
    expect(ending?.tone).toBe("positive");
    expect(ending?.detail).toContain(brl(300));
  });

  it("não avisa quando ainda faltam muitas parcelas", () => {
    const insights = buildInsights({
      ...base,
      transactions: [
        mes("2026-07", 100),
        tx({
          invoiceMonth: "2026-08",
          amount: 300,
          installment: { current: 1, total: 10, value: 300 },
        }),
      ],
    });
    expect(insights.filter((i) => i.kind === "installments_ending")).toHaveLength(0);
  });
});

describe("buildInsights — total do mês", () => {
  it("compara com o mês anterior", () => {
    const insights = buildInsights({
      ...base,
      transactions: [mes("2026-07", 1000), mes("2026-08", 1500)],
    });

    const total = insights.find((i) => i.kind === "month_total");
    expect(total?.evidence).toContainEqual({
      label: "Mês anterior",
      value: brl(1000),
    });
  });

  it("ignora diferença pequena", () => {
    const insights = buildInsights({
      ...base,
      transactions: [mes("2026-07", 1000), mes("2026-08", 1050)],
    });
    expect(insights.filter((i) => i.kind === "month_total")).toHaveLength(0);
  });
});

describe("historyDepth", () => {
  it("conta meses distintos", () => {
    expect(
      historyDepth([mes("2026-06", 1), mes("2026-07", 1), mes("2026-07", 2)]),
    ).toBe(2);
  });
});
