import { describe, expect, it } from "vitest";
import { projetar, quandoComprar, receitasRecorrentes, type MesProjetado } from "@/domain/projecao";
import type { Recurrence, Transaction } from "@/domain/types";

/**
 * Projecao: recebe, gasta e sobra, mes a mes.
 *
 * O que guarda: receita que se repete (2 de 3 meses) vira previsao, receita
 * avulsa nao; receita ja lancada no mes nao conta duas vezes; o gasto previsto
 * e o da previsao que ja existe; a sobra acumula do mes atual em diante; e os
 * itens do Radar caem no primeiro mes em que cabem, um gastando a sobra do
 * outro.
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
const receita = (mes: string, valor: number, descricao = "FAPESP Lari") =>
  tx({ type: "income", invoiceMonth: mes, description: descricao, amount: valor });
const gasto = (mes: string, valor: number, descricao = "Mercado") => tx({ invoiceMonth: mes, description: descricao, amount: valor });

const internet: Recurrence = {
  id: "r1", houseId: "c", description: "Internet", merchant: "VIVO", amount: 100, categoryId: null, cardId: null,
  ownerId: null, interval: "monthly", nextDate: "2026-10-10", expectedDay: 10, isActive: true, offCard: true, source: "manual",
};

describe("receitas que se repetem", () => {
  it("2 de 3 meses viram previsão (mediana); avulsa e mês atual não contam", () => {
    const r = receitasRecorrentes(
      [
        receita("2026-07", 5790), receita("2026-08", 5790), receita("2026-09", 5700),
        receita("2026-09", 1200, "Freela site"),
        receita("2026-10", 5790), // o mes atual nao entra na conta do que se repete
        receita("2026-05", 300, "Venda OLX"), receita("2026-06", 300, "Venda OLX"), // fora da janela
      ],
      "2026-10",
    );
    expect(r).toEqual([{ chave: "FAPESPLARI", descricao: "FAPESP Lari", cents: 579_000, vezes: 3 }]);
  });
});

describe("projetar", () => {
  const historico = [
    receita("2026-07", 5790), receita("2026-08", 5790), receita("2026-09", 5790),
    gasto("2026-07", 3000), gasto("2026-08", 3200), gasto("2026-09", 3100),
    // Mes atual: a bolsa ja caiu, e ja se gastou um tanto.
    receita("2026-10", 5790), gasto("2026-10", 1000),
  ];

  it("consolidado no passado, previsto adiante, sobra acumulando do mês atual", () => {
    const p = projetar({ transactions: historico, futuras: [], recurrences: [internet], mesAtual: "2026-10", passados: 3, futuros: 3 });
    expect(p.meses.map((m) => [m.month, m.tipo])).toEqual([
      ["2026-07", "realizado"], ["2026-08", "realizado"], ["2026-09", "realizado"],
      ["2026-10", "atual"], ["2026-11", "previsto"], ["2026-12", "previsto"], ["2027-01", "previsto"],
    ]);
    const [jul, , , out, nov] = p.meses as [MesProjetado, MesProjetado, MesProjetado, MesProjetado, MesProjetado];
    expect(jul).toMatchObject({ receitasCents: 579_000, gastosCents: 300_000, sobraCents: 279_000, acumuladoCents: null });
    // Outubro: a bolsa ja lancada nao conta de novo; o gasto e o previsto para o mes (internet + media), maior que o lancado.
    expect(out.receitasCents).toBe(579_000);
    expect(out.receitasRecorrentesCents).toBe(0);
    expect(out.gastosCents).toBeGreaterThan(100_000);
    expect(nov.receitasRecorrentesCents).toBe(579_000);
    expect(nov.acumuladoCents).toBe(out.sobraCents + nov.sobraCents);
    expect(p.sobraNoPeriodoCents).toBe(p.meses.slice(3).reduce((s, m) => s + m.sobraCents, 0));
  });

  it("receita lançada com data futura entra no mês dela, e a recorrente não duplica", () => {
    const p = projetar({
      transactions: historico,
      futuras: [receita("2026-12", 5790), receita("2026-12", 3000, "13º salário")],
      recurrences: [],
      mesAtual: "2026-10",
      passados: 0,
      futuros: 3,
    });
    const dez = p.meses.find((m) => m.month === "2026-12")!;
    expect(dez.receitasCents).toBe(879_000);
    expect(dez.receitasRecorrentesCents).toBe(0);
    expect(p.melhorMes).toBe("2026-12");
  });
});

describe("o mesmo dinheiro com outro nome", () => {
  it("valor parecido conta como já recebido; receita extra de outro valor continua extra", () => {
    const historico = [
      receita("2026-07", 9473, "MCAA Dividendos"), receita("2026-08", 9473, "MCAA Dividendos"), receita("2026-09", 9473, "MCAA Dividendos"),
      receita("2026-07", 1443, "MCAA Pró Labore"), receita("2026-08", 1443, "MCAA Pró Labore"), receita("2026-09", 1443, "MCAA Pró Labore"),
      // Outubro: os dividendos lancados so como "MCAA", e um extra.
      receita("2026-10", 10048, "MCAA"), receita("2026-10", 1443, "MCAA Pró Labore"), receita("2026-10", 600, "Agrocursos"),
    ];
    const p = projetar({ transactions: historico, futuras: [], recurrences: [], mesAtual: "2026-10", passados: 0, futuros: 1 });
    const [out, nov] = p.meses as [MesProjetado, MesProjetado];
    expect(out.receitasCents).toBe(1_004_800 + 144_300 + 60_000);
    expect(out.receitasRecorrentesCents).toBe(0);
    expect(nov.receitasCents).toBe(947_300 + 144_300);
  });
});

describe("quando comprar", () => {
  const mes = (month: string, sobraCents: number, tipo: MesProjetado["tipo"] = "previsto"): MesProjetado => ({
    month, tipo, receitasCents: 0, gastosCents: 0, sobraCents, acumuladoCents: null, receitasRecorrentesCents: 0, temEstimativa: false,
  });

  it("mais barato primeiro, cada compra gasta a sobra do outro; o que não cabe fica sem mês", () => {
    const r = quandoComprar(
      [mes("2026-09", 900_000, "realizado"), mes("2026-10", 100_000, "atual"), mes("2026-11", 100_000), mes("2026-12", 200_000)],
      [
        { id: "tv", nome: "TV", cents: 500_000 },
        { id: "creami", nome: "Ninja Creami", cents: 129_900 },
        { id: "fone", nome: "Fone", cents: 50_000 },
      ],
    );
    expect(r.map((x) => [x.item.id, x.mes])).toEqual([
      ["tv", null],
      ["creami", "2026-11"],
      ["fone", "2026-10"],
    ]);
  });
});
