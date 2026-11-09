import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { detalharMeses } from "@/domain/meses";
import { projetar } from "@/domain/projecao";
import type { MonthKey, Recurrence, Transaction } from "@/domain/types";

/**
 * Mes a mes.
 *
 * O que guarda: as linhas de cada mes somam exatamente os totais da Projecao
 * (a mesma conta da Analise); as parcelas que vem aparecem com o numero
 * certo e somem quando acabam; as contas fixas e a media do dia a dia entram
 * como previstas; a receita de todo mes aparece nos meses que vem; e o
 * grafico e a lista mostram tudo isso sem depender so da cor.
 */

let n = 0;
const tx = (p: Partial<Transaction>): Transaction =>
  ({
    id: `t${++n}`, houseId: "c", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: "2026-11-05", invoiceMonth: "2026-11", description: "x", merchantOriginal: null,
    merchantNormalized: null, merchantAlias: null, amount: 100, currency: "BRL", originalAmount: null,
    originalCurrency: null, type: "expense", origin: "invoice", status: "confirmed", categoryId: "mer",
    subcategoryId: null, note: null, receiptUrl: null, visibility: "shared", splitType: "none",
    splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null, calendarEventId: null,
    eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null, createdAt: "", updatedAt: "",
    ...p,
  }) as Transaction;

const MESES: MonthKey[] = ["2026-08", "2026-09", "2026-10", "2026-11"];
const transactions: Transaction[] = [
  // O salario, todo mes.
  ...MESES.map((m) => tx({ invoiceMonth: m, date: `${m}-05`, type: "income", amount: 9000, description: "Salário", categoryId: null })),
  // Mercado (dia a dia), todo mes.
  ...MESES.map((m) => tx({ invoiceMonth: m, date: `${m}-10`, amount: 1500, description: "Mercado", merchantNormalized: "MERCADO" })),
  // A internet, conta fixa ligada a recorrencia.
  ...MESES.map((m) => tx({ invoiceMonth: m, date: `${m}-12`, amount: 120, description: "Vivo Fibra", merchantNormalized: "VIVO", recurringId: "r1", categoryId: "cas" })),
  // A geladeira em 10x: a 4a cai em novembro.
  ...MESES.map((m, i) =>
    tx({ invoiceMonth: m, date: `${m}-15`, amount: 400, description: "Geladeira", merchantNormalized: "LOJA", installment: { current: i + 1, total: 10, value: null } }),
  ),
  // O sofa em 3x: 2a em outubro, 3a (ultima) em novembro.
  tx({ invoiceMonth: "2026-10", date: "2026-10-20", amount: 300, description: "Sofá", merchantNormalized: "SOFA", installment: { current: 2, total: 3, value: null } }),
  tx({ invoiceMonth: "2026-11", date: "2026-11-20", amount: 300, description: "Sofá", merchantNormalized: "SOFA", installment: { current: 3, total: 3, value: null } }),
];
const recurrences = [
  { id: "r1", houseId: "c", description: "Internet", merchant: "VIVO", amount: 120, categoryId: "cas", cardId: null, ownerId: null, interval: "monthly", nextDate: "2026-12-12", expectedDay: 12, isActive: true, offCard: false, source: "manual" },
] as Recurrence[];
const categorias = [
  { id: "mer", name: "Mercado" },
  { id: "cas", name: "Casa" },
];

const entrada = { transactions, futuras: [] as Transaction[], recurrences, categorias, mesAtual: "2026-11" as MonthKey, passados: 3, futuros: 8 };
const meses = detalharMeses(entrada);
const soma = (l: { cents: number }[]) => l.reduce((s, x) => s + x.cents, 0);
const mes = (m: string) => meses.find((x) => x.month === m)!;

describe("as contas fecham", () => {
  it("os totais são os da Projeção, mês a mês", () => {
    const p = projetar(entrada);
    expect(meses.map((m) => [m.month, m.receitasCents, m.gastosCents, m.sobraCents])).toEqual(
      p.meses.map((m) => [m.month, m.receitasCents, m.gastosCents, m.sobraCents]),
    );
  });

  it("em todo mês, as linhas somam o total: o que entra e as três partes do que sai", () => {
    for (const m of meses) {
      expect(soma(m.entradas)).toBe(m.receitasCents);
      expect(soma(m.parcelas)).toBe(m.parcelasCents);
      expect(soma(m.fixas)).toBe(m.fixasCents);
      expect(soma(m.diaADia)).toBe(m.diaADiaCents);
      expect(m.parcelasCents + m.fixasCents + m.diaADiaCents).toBe(m.gastosCents);
    }
  });
});

describe("os meses que passaram", () => {
  it("parcelas com o número, conta fixa, e o dia a dia por categoria", () => {
    const out = mes("2026-10");
    expect(out.tipo).toBe("realizado");
    expect(out.parcelas).toEqual([
      { descricao: "Geladeira", cents: 40_000, detalhe: "3/10", previsto: false },
      { descricao: "Sofá", cents: 30_000, detalhe: "2/3", previsto: false },
    ]);
    expect(out.fixas).toEqual([{ descricao: "Vivo Fibra", cents: 12_000, detalhe: null, previsto: false }]);
    expect(out.diaADia).toEqual([{ descricao: "Mercado", cents: 150_000, detalhe: null, previsto: false }]);
    expect(out.entradas).toEqual([{ descricao: "Salário", cents: 900_000, detalhe: null, previsto: false }]);
    expect(out.gastoPrevistoCents).toBe(0);
  });
});

describe("os meses que vêm", () => {
  it("a parcela seguinte com o número certo; a que acabou não aparece", () => {
    const dez = mes("2026-12");
    expect(dez.tipo).toBe("previsto");
    expect(dez.parcelas).toEqual([{ descricao: "Geladeira", cents: 40_000, detalhe: "5/10", previsto: true }]);
    // O sofa terminou em novembro (3/3).
    expect(dez.parcelas.some((p) => p.descricao === "Sofá")).toBe(false);
    // A geladeira termina em maio (10/10): em junho, nenhuma parcela dela.
    expect(mes("2027-05").parcelas[0]).toMatchObject({ detalhe: "10/10" });
    expect(mes("2027-06").parcelas).toEqual([]);
  });

  it("conta fixa, a média do dia a dia e o salário de todo mês, como previstos", () => {
    const dez = mes("2026-12");
    expect(dez.fixas).toEqual([{ descricao: "Internet", cents: 12_000, detalhe: "todo mês", previsto: true }]);
    expect(dez.diaADia).toEqual([{ descricao: "Gasto do dia a dia", cents: 150_000, detalhe: "média dos últimos meses", previsto: true }]);
    expect(dez.entradas).toEqual([{ descricao: "Salário", cents: 900_000, detalhe: "todo mês", previsto: true }]);
    expect(dez.gastoPrevistoCents).toBe(dez.gastosCents);
  });
});

describe("o mês atual", () => {
  it("o que já saiu, com o número das parcelas, e o que ainda deve sair como estimativa", () => {
    const nov = mes("2026-11");
    expect(nov.tipo).toBe("atual");
    expect(nov.parcelas.map((p) => p.detalhe)).toEqual(["4/10", "3/3"]);
    const falta = nov.diaADia.find((l) => l.previsto);
    // Novembro lancado: 1.500 + 120 + 400 + 300 = 2.320; o previsto do mes inteiro decide o resto.
    expect(nov.gastosCents - 232_000).toBe(falta?.cents ?? 0);
    expect(nov.gastoPrevistoCents).toBe(falta?.cents ?? 0);
  });
});

describe("o mês que acabou de começar", () => {
  it("o que ainda deve sair vira uma linha de estimativa, e as contas fecham", () => {
    // Novembro so com o salario: o gasto do mes vem todo da previsao.
    const comeco = transactions.filter((t) => t.invoiceMonth !== "2026-11" || t.type === "income");
    const [nov] = detalharMeses({ ...entrada, transactions: comeco, passados: 0, futuros: 0 });
    const falta = nov!.diaADia.find((l) => l.previsto)!;
    expect(falta).toMatchObject({ descricao: "Ainda deve sair até o fim do mês", detalhe: "estimativa" });
    expect(falta.cents).toBe(nov!.gastosCents);
    expect(nov!.gastoPrevistoCents).toBe(nov!.gastosCents);
    expect(nov!.parcelasCents + nov!.fixasCents + nov!.diaADiaCents).toBe(nov!.gastosCents);
  });
});

describe("a tela", () => {
  it("o gráfico: uma coluna por mês, com os números no rótulo; tocar mostra o mês e leva à lista", async () => {
    const { GraficoDosMeses } = await import("@/components/meses/grafico-dos-meses");
    render(<GraficoDosMeses colunas={meses} atual="2026-11" />);
    const colunas = screen.getAllByRole("button");
    expect(colunas).toHaveLength(12);
    const dez = screen.getByRole("button", { name: /dezembro de 2026, previsto: entra R\$\s9\.000,00/ });
    fireEvent.click(dez);
    expect(dez.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: /Ver a lista de dezembro/ }).getAttribute("href")).toBe("#mes-2026-12");
    // Legenda: a cor nunca sozinha.
    for (const nome of ["Parcelas", "Contas fixas", "Dia a dia", "Entradas", "Previsto"]) {
      expect(screen.getByText(nome)).toBeTruthy();
    }
  });

  it("a lista: o mês atual aberto, cada grupo com as suas linhas", async () => {
    const { ListaDoMes } = await import("@/components/meses/lista-do-mes");
    const { container } = render(
      <>
        <ListaDoMes mes={mes("2026-11")} />
        <ListaDoMes mes={mes("2026-12")} />
      </>,
    );
    const [nov, dez] = container.querySelectorAll("details");
    expect(nov!.open).toBe(true);
    expect(dez!.open).toBe(false);
    expect(nov!.id).toBe("mes-2026-11");
    const parcelas = within(nov as HTMLElement).getByRole("heading", { name: /Parcelas/ }).closest("section")!;
    expect(within(parcelas).getByText("Geladeira")).toBeTruthy();
    expect(within(parcelas).getByText("4/10")).toBeTruthy();
    expect(within(dez as HTMLElement).getByText("5/10 · previsto")).toBeTruthy();
  });
});
