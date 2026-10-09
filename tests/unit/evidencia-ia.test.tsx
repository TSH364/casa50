import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { lerEvidencia, plural } from "@/domain/evidencia";
import { formatCents } from "@/lib/money";
import { buildFacts } from "@/domain/ai-insights";
import type { Category, Transaction } from "@/domain/types";

/**
 * Leitura da IA, a parte visual - pedido da casa: "isso pode ficar mais
 * atrativo".
 *
 * O que guarda: as frases de fato que o app monta (`buildFacts`) sao lidas
 * de volta - categoria com media vira comparacao, orcamento vira gasto x
 * limite, loja vira valor, "41% do gasto" vira parte do todo -, o que nao
 * se reconhece continua texto, e o cartao desenha tudo isso.
 */

vi.mock("@/actions/ai-insights", () => ({ analyzeMonth: vi.fn() }));

// Os valores saem de formatCents, como em buildFacts (com o espaco duro do R$).
const R = (c: number) => formatCents(c);

describe("lerEvidencia", () => {
  it("categoria com média anterior: comparação, com a diferença e as notas", () => {
    const l = lerEvidencia(
      "Categoria Casa no mês",
      `${R(797_756)} em 12 lançamento(s), 50% do gasto; média anterior ${R(23_693)}, diferença +${R(774_063)} (+3267%)`,
    );
    expect(l).toEqual({
      tipo: "comparacao",
      titulo: "Casa",
      medida: { atualCents: 797_756, atualRotulo: "No mês", referenciaCents: 23_693, referenciaRotulo: "média" },
      diferenca: "+3267%",
      notas: ["12 lançamentos", "50% do gasto"],
    });
  });

  it("categoria sem média: parte do gasto", () => {
    expect(lerEvidencia("Categoria Pet no mês", `${R(12_000)} em 1 lançamento(s), 3% do gasto`)).toEqual({
      tipo: "parte", titulo: "Pet", cents: 12_000, pct: 3, notas: ["1 lançamento"],
    });
  });

  it("orçamento, conta fixa, loja e parte do todo", () => {
    expect(lerEvidencia("Orçamento de Mercado", `${R(181_240)} de ${R(150_000)} (121%)`)).toMatchObject({
      tipo: "comparacao", medida: { atualCents: 181_240, referenciaCents: 150_000 }, diferenca: "121% do limite",
    });
    expect(lerEvidencia("Conta fixa Internet", `cadastrada ${R(10_000)}, cobrada ${R(12_990)}, diferença +${R(2_990)}`)).toMatchObject({
      tipo: "comparacao", titulo: "Internet", medida: { atualCents: 12_990, referenciaCents: 10_000 },
    });
    expect(lerEvidencia("Loja LEROY MERLIN", `${R(481_306)} em 2 compra(s)`)).toEqual({
      tipo: "valor", titulo: "LEROY MERLIN", cents: 481_306, notas: ["2 compras"],
    });
    expect(lerEvidencia("Compras abaixo de R$ 50 no mês", `51 compras, ${R(118_403)} (7% do gasto)`)).toEqual({
      tipo: "parte", titulo: "Compras abaixo de R$ 50 no mês", cents: 118_403, pct: 7, notas: ["51 compras"],
    });
    expect(lerEvidencia("Parte do gasto do mês que veio de parcelas", `${R(652_952)} (41%)`)).toMatchObject({ tipo: "parte", pct: 41 });
  });

  it("o que não reconhece continua texto, em linhas, com o mês legível", () => {
    expect(
      lerEvidencia("Observação do app: 5 parcelas estão acabando", `LEROY MERLIN ${R(477_220)}/mês · última em 2026-11; Total liberado por mês ${R(567_721)}`),
    ).toEqual({
      tipo: "texto",
      titulo: "5 parcelas estão acabando",
      linhas: [`LEROY MERLIN ${R(477_220)}/mês · última em nov/26`, `Total liberado por mês ${R(567_721)}`],
    });
  });

  it("lê as frases que buildFacts monta de verdade", () => {
    const tx = (m: string, cents: number, id: string, extra: Partial<Transaction> = {}) =>
      ({
        id, houseId: "c", invoiceId: null, cardId: null, memberId: null, isJoint: false, date: `${m}-05`, invoiceMonth: m,
        description: "LEROY MERLIN", merchantOriginal: null, merchantNormalized: null, merchantAlias: null, amount: cents / 100,
        currency: "BRL", originalAmount: null, originalCurrency: null, type: "expense", origin: "manual", status: "confirmed",
        categoryId: "casa", subcategoryId: null, note: null, receiptUrl: null, visibility: "shared", splitType: "none",
        splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null, calendarEventId: null,
        eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null, createdAt: "", updatedAt: "", ...extra,
      }) as Transaction;
    const fatos = buildFacts({
      month: "2026-10",
      transactions: [tx("2026-08", 20_000, "a"), tx("2026-09", 30_000, "b"), tx("2026-10", 90_000, "c")],
      categories: [{ id: "casa", name: "Casa", kind: "expense" } as Category],
      budgets: [{ id: "o", houseId: "c", categoryId: "casa", month: "2026-10", limitAmount: 800 }],
      recurrenceMatches: [],
      members: [],
      insights: [],
    });
    const ler = (label: string) => {
      const f = fatos.find((x) => x.label === label)!;
      return lerEvidencia(f.label, f.value);
    };
    expect(ler("Categoria Casa no mês")).toMatchObject({
      tipo: "comparacao", medida: { atualCents: 90_000, referenciaCents: 25_000 }, diferenca: "+260%",
    });
    expect(ler("Loja LEROY MERLIN")).toMatchObject({ tipo: "valor", cents: 90_000, notas: ["1 compra"] });
    expect(ler("Orçamento de Casa")).toMatchObject({ tipo: "comparacao", diferenca: "113% do limite" });
  });

  it("plural", () => {
    expect(plural("36 lançamento(s) e 1 compra(s)")).toBe("36 lançamentos e 1 compra");
  });
});

describe("o cartão da Leitura da IA", () => {
  it("desenha a comparação, as lojas e a sugestão", async () => {
    const { AiAnalysisCard } = await import("@/components/insights/ai-analysis");
    render(
      <AiAnalysisCard
        month="2026-10"
        scope="casa"
        enabled
        initial={{
          createdAt: "2026-10-09T02:54:00Z",
          dropped: 0,
          items: [
            {
              title: "Gastos com Casa impulsionam o orçamento",
              text: "A categoria Casa fechou em 12 lançamento(s).",
              tone: "attention",
              suggestion: "Acompanhar a reforma.",
              evidence: [
                { label: "Categoria Casa no mês", value: `${R(797_756)} em 12 lançamento(s), 50% do gasto; média anterior ${R(23_693)}, diferença +${R(774_063)} (+3267%)` },
                { label: "Loja LEROY MERLIN", value: `${R(481_306)} em 2 compra(s)` },
              ],
            },
          ],
        } as never}
      />,
    );
    expect(screen.getByText("+3267%")).toBeTruthy();
    expect(screen.getByRole("img", { name: /No mês: R\$\s7\.977,56; média: R\$\s236,93/ })).toBeTruthy();
    expect(screen.getByText("LEROY MERLIN")).toBeTruthy();
    expect(screen.getByText("A categoria Casa fechou em 12 lançamentos.")).toBeTruthy();
    expect(screen.getByText("Sugestão:")).toBeTruthy();
  });
});
