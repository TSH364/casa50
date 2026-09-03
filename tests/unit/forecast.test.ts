import { describe, expect, it } from "vitest";
import {
  detectRecurrences,
  forecastMonths,
  goalProgress,
  installmentSeries,
  installmentsDueIn,
  reconcileRecurrences,
} from "@/domain/forecast";
import type { Recurrence, Transaction } from "@/domain/types";

/** Lançamento mínimo, com os campos que o domínio realmente lê. */
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

function rec(overrides: Partial<Recurrence> = {}): Recurrence {
  return {
    id: Math.random().toString(36).slice(2),
    houseId: "casa",
    description: "Netflix",
    merchant: "Netflix",
    amount: 55.9,
    categoryId: null,
    cardId: null,
    ownerId: null,
    interval: "monthly",
    nextDate: "2026-09-10",
    expectedDay: 10,
    isActive: true,
    source: "manual",
    ...overrides,
  };
}

describe("installmentSeries", () => {
  it("agrupa as parcelas da mesma compra", () => {
    const series = installmentSeries(
      [
        tx({
          merchantNormalized: "MAGAZINE LUIZA",
          amount: 289.9,
          invoiceMonth: "2026-06",
          installment: { current: 1, total: 10, value: 289.9 },
        }),
        tx({
          merchantNormalized: "MAGAZINE LUIZA",
          amount: 289.9,
          invoiceMonth: "2026-07",
          installment: { current: 2, total: 10, value: 289.9 },
        }),
        tx({
          merchantNormalized: "MAGAZINE LUIZA",
          amount: 289.9,
          invoiceMonth: "2026-08",
          installment: { current: 3, total: 10, value: 289.9 },
        }),
      ],
      "2026-08",
    );

    expect(series).toHaveLength(1);
    expect(series[0]?.paidCount).toBe(3);
    expect(series[0]?.remainingCount).toBe(7);
    expect(series[0]?.installmentCents).toBe(28990);
    expect(series[0]?.remainingCents).toBe(7 * 28990);
    expect(series[0]?.purchaseCents).toBe(10 * 28990);
    expect(series[0]?.endsOn).toBe("2027-03");
  });

  it("usa a maior parcela vista, não a contagem de lançamentos", () => {
    // Histórico com buraco: só junho e agosto foram importados. Julho
    // aconteceu de qualquer forma, e contar linhas diria "2 pagas".
    const series = installmentSeries(
      [
        tx({
          merchantNormalized: "SOFA",
          amount: 100,
          invoiceMonth: "2026-06",
          installment: { current: 1, total: 6, value: 100 },
        }),
        tx({
          merchantNormalized: "SOFA",
          amount: 100,
          invoiceMonth: "2026-08",
          installment: { current: 3, total: 6, value: 100 },
        }),
      ],
      "2026-08",
    );

    expect(series[0]?.paidCount).toBe(3);
    expect(series[0]?.remainingCount).toBe(3);
  });

  it("separa duas compras diferentes na mesma loja", () => {
    const series = installmentSeries(
      [
        tx({
          merchantNormalized: "LOJA",
          amount: 100,
          installment: { current: 1, total: 10, value: 100 },
        }),
        tx({
          merchantNormalized: "LOJA",
          amount: 250,
          installment: { current: 1, total: 10, value: 250 },
        }),
      ],
      "2026-08",
    );
    expect(series).toHaveLength(2);
  });

  it("marca como terminada a compra na última parcela", () => {
    const series = installmentSeries(
      [
        tx({
          merchantNormalized: "TV",
          amount: 100,
          installment: { current: 6, total: 6, value: 100 },
        }),
      ],
      "2026-08",
    );
    expect(series[0]?.isFinished).toBe(true);
    expect(series[0]?.remainingCents).toBe(0);
  });

  it("ignora lançamento sem parcela", () => {
    expect(installmentSeries([tx()], "2026-08")).toHaveLength(0);
  });
});

describe("installmentsDueIn", () => {
  const series = installmentSeries(
    [
      tx({
        merchantNormalized: "SOFA",
        amount: 300,
        invoiceMonth: "2026-08",
        installment: { current: 3, total: 6, value: 300 },
      }),
    ],
    "2026-08",
  );

  it("soma a parcela nos meses em que ela ainda cai", () => {
    expect(installmentsDueIn(series, "2026-09")).toBe(30000);
    expect(installmentsDueIn(series, "2026-10")).toBe(30000);
    expect(installmentsDueIn(series, "2026-11")).toBe(30000);
  });

  it("para quando as parcelas acabam", () => {
    // 3 de 6 pagas em agosto: set, out e nov. Dezembro já está livre.
    expect(installmentsDueIn(series, "2026-12")).toBe(0);
  });

  it("não conta o mês que já foi lançado", () => {
    expect(installmentsDueIn(series, "2026-08")).toBe(0);
  });
});

describe("reconcileRecurrences", () => {
  const agora = new Date("2026-08-20T12:00:00");

  it("confirma quando o lançamento aparece com o valor esperado", () => {
    const result = reconcileRecurrences(
      [rec()],
      [tx({ merchantNormalized: "NETFLIX COM", amount: 55.9 })],
      "2026-08",
      agora,
    );
    expect(result[0]?.status).toBe("confirmed");
    expect(result[0]?.differenceCents).toBe(0);
  });

  it("acusa divergência quando o valor muda", () => {
    const result = reconcileRecurrences(
      [rec()],
      [tx({ merchantNormalized: "NETFLIX COM", amount: 62.9 })],
      "2026-08",
      agora,
    );
    expect(result[0]?.status).toBe("divergent");
    expect(result[0]?.differenceCents).toBe(700);
  });

  it("tolera centavos de diferença", () => {
    const result = reconcileRecurrences(
      [rec()],
      [tx({ merchantNormalized: "NETFLIX COM", amount: 56.4 })],
      "2026-08",
      agora,
    );
    expect(result[0]?.status).toBe("confirmed");
  });

  it("acusa ausência quando o dia esperado já passou", () => {
    const result = reconcileRecurrences([rec()], [], "2026-08", agora);
    expect(result[0]?.status).toBe("missing");
  });

  it("não acusa ausência antes do dia esperado", () => {
    // Dia 5, conta esperada para o dia 10: ainda não venceu. Alarmar aqui
    // seria mentira, e a secao 10 pede o contrário.
    const result = reconcileRecurrences(
      [rec({ expectedDay: 10 })],
      [],
      "2026-08",
      new Date("2026-08-05T12:00:00"),
    );
    expect(result[0]?.status).toBe("pending");
  });

  it("trata mês futuro como pendente, nunca ausente", () => {
    const result = reconcileRecurrences([rec()], [], "2026-12", agora);
    expect(result[0]?.status).toBe("pending");
  });

  it("acusa ausência em mês passado", () => {
    const result = reconcileRecurrences([rec()], [], "2026-07", agora);
    expect(result[0]?.status).toBe("missing");
  });

  it("não deixa dois recorrentes disputarem o mesmo lançamento", () => {
    const result = reconcileRecurrences(
      [
        rec({ description: "Netflix", merchant: "Netflix" }),
        rec({ description: "Netflix Extra", merchant: "Netflix" }),
      ],
      [tx({ merchantNormalized: "NETFLIX", amount: 55.9 })],
      "2026-08",
      agora,
    );
    expect(result[0]?.status).toBe("confirmed");
    expect(result[1]?.status).toBe("missing");
  });

  it("ignora recorrência desativada", () => {
    const result = reconcileRecurrences(
      [rec({ isActive: false })],
      [],
      "2026-08",
      agora,
    );
    expect(result).toHaveLength(0);
  });
});

describe("detectRecurrences", () => {
  function meses(months: string[], amount: number, merchant = "SPOTIFY") {
    return months.map((m) =>
      tx({
        merchantNormalized: merchant,
        description: merchant,
        amount,
        invoiceMonth: m,
        date: `${m}-15`,
      }),
    );
  }

  it("sugere quando há três meses seguidos com o mesmo valor", () => {
    const found = detectRecurrences(
      meses(["2026-06", "2026-07", "2026-08"], 34.9),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.amountCents).toBe(3490);
    expect(found[0]?.expectedDay).toBe(15);
  });

  it("não sugere com menos meses que o mínimo", () => {
    expect(detectRecurrences(meses(["2026-07", "2026-08"], 34.9))).toHaveLength(0);
  });

  it("exige meses consecutivos", () => {
    // Junho, agosto e outubro é sazonalidade, não assinatura.
    expect(
      detectRecurrences(meses(["2026-06", "2026-08", "2026-10"], 34.9)),
    ).toHaveLength(0);
  });

  it("descarta quando os valores variam demais", () => {
    const found = detectRecurrences([
      ...meses(["2026-06"], 40),
      ...meses(["2026-07"], 120),
      ...meses(["2026-08"], 250),
    ]);
    expect(found).toHaveLength(0);
  });

  it("ignora parcelas", () => {
    // Parcela repete e termina; virar assinatura projetaria para sempre.
    const parcelas = ["2026-06", "2026-07", "2026-08"].map((m, i) =>
      tx({
        merchantNormalized: "MOVEIS",
        amount: 200,
        invoiceMonth: m,
        installment: { current: i + 1, total: 10, value: 200 },
      }),
    );
    expect(detectRecurrences(parcelas)).toHaveLength(0);
  });

  it("ignora mês com duas compras na mesma loja", () => {
    // Duas idas ao mercado no mesmo mês não fazem dele uma assinatura, mas o
    // resto da sequência ainda vale - o mês só não conta duas vezes.
    const found = detectRecurrences([
      ...meses(["2026-06", "2026-07", "2026-08"], 34.9),
      tx({
        merchantNormalized: "SPOTIFY",
        amount: 34.9,
        invoiceMonth: "2026-08",
        date: "2026-08-28",
      }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.months).toHaveLength(3);
  });
});

describe("forecastMonths", () => {
  const parcelado = tx({
    merchantNormalized: "SOFA",
    amount: 300,
    invoiceMonth: "2026-08",
    installment: { current: 1, total: 6, value: 300 },
  });

  const variaveis = [
    tx({ merchantNormalized: "MERCADO", amount: 500, invoiceMonth: "2026-07" }),
    tx({ merchantNormalized: "MERCADO", amount: 700, invoiceMonth: "2026-08" }),
  ];

  it("separa comprometido, recorrente e estimado", () => {
    const [setembro] = forecastMonths({
      transactions: [parcelado, ...variaveis],
      recurrences: [rec({ amount: 55.9 })],
      fromMonth: "2026-08",
      months: 1,
    });

    expect(setembro?.month).toBe("2026-09");
    expect(setembro?.committedCents).toBe(30000);
    expect(setembro?.recurringCents).toBe(5590);
    expect(setembro?.estimatedCents).toBe(60000);
    expect(setembro?.totalCents).toBe(30000 + 5590 + 60000);
  });

  it("avisa quando não há histórico para estimar", () => {
    const [mes] = forecastMonths({
      transactions: [parcelado],
      recurrences: [],
      fromMonth: "2026-08",
      months: 1,
    });
    expect(mes?.hasEstimate).toBe(false);
    expect(mes?.estimatedCents).toBe(0);
  });

  it("não conta a recorrência duas vezes no gasto variável", () => {
    // A Netflix aparece no histórico E como recorrência. Se entrasse na média
    // do variável, seria somada duas vezes na previsão.
    const [mes] = forecastMonths({
      transactions: [
        tx({ merchantNormalized: "NETFLIX", amount: 55.9, invoiceMonth: "2026-07" }),
        tx({ merchantNormalized: "NETFLIX", amount: 55.9, invoiceMonth: "2026-08" }),
      ],
      recurrences: [rec({ merchant: "Netflix", amount: 55.9 })],
      fromMonth: "2026-08",
      months: 1,
    });
    expect(mes?.estimatedCents).toBe(0);
    expect(mes?.recurringCents).toBe(5590);
  });

  it("devolve um mês por posição pedida", () => {
    const meses = forecastMonths({
      transactions: [parcelado],
      recurrences: [],
      fromMonth: "2026-08",
      months: 3,
    });
    expect(meses.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
});

describe("goalProgress", () => {
  const hoje = new Date("2026-09-15T12:00:00");
  const g = (current: number, target: number, opts = {}) =>
    goalProgress(current, target, { today: hoje, ...opts });

  it("calcula o que falta", () => {
    const p = g(300000, 1000000);
    expect(p.remainingCents).toBe(700000);
    expect(p.ratio).toBeCloseTo(0.3);
    expect(p.isComplete).toBe(false);
  });

  it("reconhece meta cumprida", () => {
    const p = g(1000000, 1000000);
    expect(p.isComplete).toBe(true);
    expect(p.remainingCents).toBe(0);
    expect(p.neededPerMonthCents).toBeNull();
  });

  it("não fica negativo quando passa da meta", () => {
    const p = g(1200000, 1000000);
    expect(p.remainingCents).toBe(0);
    expect(p.isComplete).toBe(true);
  });

  it("divide o que falta pelos meses até o prazo", () => {
    // Set/2026 até mar/2027 são 6 meses; faltam R$ 7.000.
    const p = g(300000, 1000000, { targetDate: "2027-03-31" });
    expect(p.monthsLeft).toBe(6);
    expect(p.neededPerMonthCents).toBe(Math.ceil(700000 / 6));
  });

  it("projeta o mês de conclusão pelo aporte declarado", () => {
    const p = g(300000, 1000000, { monthlyContributionCents: 100000 });
    // R$ 7.000 restantes a R$ 1.000/mês = 7 meses.
    expect(p.projectedMonth).toBe("2027-04");
  });

  it("diz que está fora do ritmo quando o aporte não alcança o prazo", () => {
    const p = g(300000, 1000000, {
      targetDate: "2027-03-31",
      monthlyContributionCents: 50000,
    });
    expect(p.onTrack).toBe(false);
  });

  it("diz que está no ritmo quando o aporte alcança", () => {
    const p = g(300000, 1000000, {
      targetDate: "2027-03-31",
      monthlyContributionCents: 200000,
    });
    expect(p.onTrack).toBe(true);
  });

  it("não julga ritmo sem prazo ou sem aporte", () => {
    // Cobrar ritmo de uma meta sem prazo seria inventar uma exigência.
    expect(g(300000, 1000000).onTrack).toBeNull();
    expect(g(300000, 1000000, { targetDate: "2027-03-31" }).onTrack).toBeNull();
    expect(g(300000, 1000000, { monthlyContributionCents: 50000 }).onTrack).toBeNull();
  });

  it("trata prazo já vencido como tudo para agora", () => {
    const p = g(300000, 1000000, { targetDate: "2026-08-31" });
    expect(p.monthsLeft).toBe(0);
    expect(p.neededPerMonthCents).toBe(700000);
  });
});

describe("forecastMonths — estorno abate a despesa", () => {
  it("anuidade estornada não aumenta o compromisso futuro", () => {
    // Regra essencial do produto: anuidade com estorno esperado não pode
    // inflar a previsão. Cobrada e estornada no mesmo mês, o líquido é zero.
    const [mes] = forecastMonths({
      transactions: [
        tx({ merchantNormalized: "MERCADO", amount: 500, invoiceMonth: "2026-07" }),
        tx({ merchantNormalized: "MERCADO", amount: 500, invoiceMonth: "2026-08" }),
        tx({
          merchantNormalized: "ANUIDADE",
          description: "Anuidade diferenciada",
          amount: 400,
          type: "fee",
          invoiceMonth: "2026-08",
        }),
        tx({
          merchantNormalized: "ANUIDADE",
          description: "Estorno de anuidade",
          amount: 400,
          type: "refund",
          invoiceMonth: "2026-08",
        }),
      ],
      recurrences: [],
      fromMonth: "2026-08",
      months: 1,
    });

    // Sem o abatimento, agosto contaria 900 e a média subiria para 700.
    expect(mes?.estimatedCents).toBe(50000);
  });

  it("mês com estorno maior que a despesa vale zero, não negativo", () => {
    const [mes] = forecastMonths({
      transactions: [
        tx({ merchantNormalized: "LOJA", amount: 100, invoiceMonth: "2026-07" }),
        tx({
          merchantNormalized: "LOJA",
          amount: 900,
          type: "refund",
          invoiceMonth: "2026-08",
        }),
      ],
      recurrences: [],
      fromMonth: "2026-08",
      months: 1,
    });

    expect(mes?.estimatedCents).toBe(5000);
    expect(mes?.estimatedCents).toBeGreaterThanOrEqual(0);
  });
});
