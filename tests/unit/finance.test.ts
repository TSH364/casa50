import { describe, expect, it } from "vitest";
import {
  budgetProgress,
  committedInstallments,
  incomeCents,
  spendingCents,
  suggestBudget,
  summarizeMonth,
  totalsByCategory,
} from "@/domain/finance";
import { addMonths, daysRemaining, monthDiff, monthOf, monthRange } from "@/domain/month";
import type { Transaction } from "@/domain/types";

let seq = 0;

/** Lancamento minimo valido; cada teste sobrescreve so o que importa. */
function tx(partial: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    houseId: "casa",
    invoiceId: null,
    cardId: null,
    memberId: null,
    date: "2026-08-12",
    invoiceMonth: "2026-08",
    description: "Compra",
    merchantOriginal: null,
    merchantNormalized: null,
    merchantAlias: null,
    amount: 100,
    currency: "BRL",
    originalAmount: null,
    originalCurrency: null,
    type: "expense",
    origin: "invoice",
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
    createdAt: "2026-08-12T00:00:00Z",
    updatedAt: "2026-08-12T00:00:00Z",
    ...partial,
  };
}

describe("spendingCents - papel de cada tipo", () => {
  it("despesa, tarifa e ajuste somam", () => {
    expect(spendingCents(tx({ type: "expense", amount: 32.9 }))).toBe(3290);
    expect(spendingCents(tx({ type: "fee", amount: 12 }))).toBe(1200);
    expect(spendingCents(tx({ type: "adjustment", amount: 5 }))).toBe(500);
  });

  it("estorno subtrai em vez de virar despesa nova", () => {
    expect(spendingCents(tx({ type: "refund", amount: 32.9 }))).toBe(-3290);
  });

  it("pagamento de fatura nao e gasto", () => {
    expect(spendingCents(tx({ type: "payment", amount: 2000 }))).toBe(0);
  });

  it("receita nao entra no total gasto", () => {
    // O codigo anterior devolvia -amount aqui, misturando receita com despesa.
    expect(spendingCents(tx({ type: "income", amount: 5000 }))).toBe(0);
    expect(incomeCents(tx({ type: "income", amount: 5000 }))).toBe(500000);
  });

  it("lancamento oculto nao conta em nada", () => {
    expect(spendingCents(tx({ isHidden: true, amount: 100 }))).toBe(0);
    expect(incomeCents(tx({ type: "income", isHidden: true }))).toBe(0);
  });
});

describe("summarizeMonth", () => {
  const dados = [
    tx({ type: "expense", amount: 1000 }),
    tx({ type: "expense", amount: 500 }),
    tx({ type: "refund", amount: 200 }),
    tx({ type: "payment", amount: 3000 }),
    tx({ type: "income", amount: 4000 }),
    tx({ invoiceMonth: "2026-07", amount: 999 }),
    tx({ status: "forecast", amount: 300 }),
    tx({ status: "cancelled", amount: 700 }),
  ];

  it("separa gasto, receita e saldo", () => {
    const s = summarizeMonth(dados, "2026-08");
    expect(s.spentCents).toBe(130000); // 1000 + 500 - 200
    expect(s.incomeCents).toBe(400000);
    expect(s.balanceCents).toBe(270000);
  });

  it("exclui pagamento de fatura do total gasto", () => {
    const s = summarizeMonth(dados, "2026-08");
    expect(s.spentCents).not.toBe(130000 + 300000);
  });

  it("ignora outros meses", () => {
    expect(summarizeMonth(dados, "2026-07").spentCents).toBe(99900);
  });

  it("mantem previsao fora do realizado, em campo proprio", () => {
    const s = summarizeMonth(dados, "2026-08");
    expect(s.forecastCents).toBe(30000);
    expect(s.spentCents).toBe(130000);
  });

  it("descarta lancamento cancelado", () => {
    const s = summarizeMonth(dados, "2026-08");
    expect(s.spentCents).toBe(130000);
  });

  it("filtra por membro e por cartao", () => {
    const dois = [
      tx({ memberId: "vini", cardId: "nu", amount: 100 }),
      tx({ memberId: "lari", cardId: "nu", amount: 200 }),
      tx({ memberId: "vini", cardId: "itau", amount: 400 }),
    ];
    expect(summarizeMonth(dois, "2026-08", { memberId: "vini" }).spentCents).toBe(50000);
    expect(summarizeMonth(dois, "2026-08", { cardId: "nu" }).spentCents).toBe(30000);
    expect(
      summarizeMonth(dois, "2026-08", { memberId: "vini", cardId: "nu" }).spentCents,
    ).toBe(10000);
  });

  it("recalcula o total ao ocultar uma categoria e preserva o bruto", () => {
    const dados2 = [
      tx({ categoryId: "alimentacao", amount: 300 }),
      tx({ categoryId: "transporte", amount: 200 }),
    ];
    const s = summarizeMonth(dados2, "2026-08", {
      hiddenCategoryIds: new Set(["transporte"]),
    });
    expect(s.spentCents).toBe(30000);
    expect(s.hiddenCents).toBe(20000);
    expect(s.grossSpentCents).toBe(50000);
  });
});

describe("totalsByCategory", () => {
  it("agrupa, ordena do maior para o menor e calcula a fatia", () => {
    const dados = [
      tx({ categoryId: "a", amount: 100 }),
      tx({ categoryId: "a", amount: 200 }),
      tx({ categoryId: "b", amount: 700 }),
    ];
    const [primeiro, segundo] = totalsByCategory(dados, "2026-08");
    expect(primeiro?.categoryId).toBe("b");
    expect(primeiro?.totalCents).toBe(70000);
    expect(primeiro?.share).toBeCloseTo(0.7);
    expect(segundo?.categoryId).toBe("a");
    expect(segundo?.count).toBe(2);
  });

  it("mantem os sem categoria em um grupo proprio", () => {
    const totals = totalsByCategory([tx({ categoryId: null })], "2026-08");
    expect(totals[0]?.categoryId).toBeNull();
  });
});

describe("committedInstallments", () => {
  const parcelas = [
    tx({ invoiceMonth: "2026-09", amount: 300, installment: { current: 2, total: 10, value: 300 } }),
    tx({ invoiceMonth: "2026-10", amount: 300, installment: { current: 3, total: 10, value: 300 } }),
    tx({ invoiceMonth: "2026-11", amount: 300, installment: { current: 4, total: 10, value: 300 } }),
    tx({ invoiceMonth: "2026-12", amount: 300, installment: { current: 5, total: 10, value: 300 } }),
    tx({ invoiceMonth: "2026-09", amount: 999 }), // sem parcela
  ];

  it("respeita o numero de meses pedido", () => {
    // O codigo anterior fazia slice(0, months * 1000) e nunca limitava por mes.
    const meses = committedInstallments(parcelas, "2026-08", 3);
    expect(meses.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(meses.some((m) => m.month === "2026-12")).toBe(false);
  });

  it("devolve o mes mesmo sem parcelas, para a interface nao sumir com o card", () => {
    const meses = committedInstallments([], "2026-08", 3);
    expect(meses).toHaveLength(3);
    expect(meses[0]?.totalCents).toBe(0);
    expect(meses[0]?.count).toBe(0);
  });

  it("ignora lancamentos sem parcela", () => {
    const setembro = committedInstallments(parcelas, "2026-08", 3)[0];
    expect(setembro?.totalCents).toBe(30000);
    expect(setembro?.count).toBe(1);
  });
});

describe("budgetProgress", () => {
  const agosto = new Date("2026-08-20T12:00:00");

  it("calcula restante e ritmo diario", () => {
    // Exemplo da secao 7: R$ 1.620 de R$ 2.000, restam R$ 380.
    const p = budgetProgress(162000, 200000, "2026-08", agosto);
    expect(p.remainingCents).toBe(38000);
    expect(p.overCents).toBe(0);
    expect(p.isOver).toBe(false);
    expect(p.daysLeft).toBe(12);
    expect(p.dailyPaceCents).toBe(3166); // R$ 31,66/dia
  });

  it("destaca o excedente quando estoura", () => {
    const p = budgetProgress(230000, 200000, "2026-08", agosto);
    expect(p.isOver).toBe(true);
    expect(p.overCents).toBe(30000);
    expect(p.remainingCents).toBe(0);
    expect(p.dailyPaceCents).toBe(0);
    expect(p.ratio).toBeCloseTo(1.15);
  });

  it("alerta a partir de 80% do limite", () => {
    expect(budgetProgress(159000, 200000, "2026-08", agosto).isWarning).toBe(false);
    expect(budgetProgress(160000, 200000, "2026-08", agosto).isWarning).toBe(true);
  });

  it("nao divide por zero em mes ja encerrado", () => {
    const p = budgetProgress(100000, 200000, "2026-05", agosto);
    expect(p.daysLeft).toBe(0);
    expect(Number.isFinite(p.dailyPaceCents)).toBe(true);
    expect(p.dailyPaceCents).toBe(0);
  });
});

describe("suggestBudget", () => {
  it("sugere a media quando ha historico suficiente", () => {
    expect(suggestBudget([100000, 120000, 140000])).toBe(120000);
  });

  it("nao sugere com historico curto demais", () => {
    expect(suggestBudget([100000, 120000])).toBeNull();
  });
});

describe("meses", () => {
  it("nao escorrega de mes por fuso horario", () => {
    // new Date("2026-08-01").getMonth() devolve julho em fuso negativo.
    expect(monthOf("2026-08-01")).toBe("2026-08");
    expect(monthOf("2026-12-31")).toBe("2026-12");
  });

  it("avanca e retrocede virando o ano", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthDiff("2026-08", "2026-11")).toBe(3);
  });

  it("monta intervalos inclusivos", () => {
    expect(monthRange("2026-08", "2026-10")).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("conta dias restantes incluindo hoje", () => {
    const hoje = new Date("2026-08-20T12:00:00");
    expect(daysRemaining("2026-08", hoje)).toBe(12);
    expect(daysRemaining("2026-07", hoje)).toBe(0);
    expect(daysRemaining("2026-09", hoje)).toBe(30);
  });
});
