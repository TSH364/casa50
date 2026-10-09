import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { summarizeMonth } from "@/domain/finance";
import type { Transaction } from "@/domain/types";

/**
 * Gasto e recebido separados na tela de Extratos - pedido da casa: "ele ainda
 * esta somando o quanto a gente recebeu; o que gastou em vermelhinho e o que
 * recebeu em azulzinho".
 *
 * O que guarda: o total gasto nao leva a receita; a receita aparece ao lado,
 * em azul e com "+"; e na lista cada valor tem a cor do que e - gasto em
 * vermelho, receita em azul, estorno em verde.
 */

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/transactions", () => ({
  deleteTransaction: vi.fn(),
  setTransactionCategory: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
}));
vi.mock("@/actions/jev", () => ({ suggestCategoryFromText: vi.fn() }));

let seq = 0;
function tx(partial: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    houseId: "casa",
    invoiceId: null,
    cardId: null,
    memberId: null,
    isJoint: false,
    date: "2026-09-04",
    invoiceMonth: "2026-09",
    description: "Compra",
    merchantOriginal: null,
    merchantNormalized: null,
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
    calendarEventId: null,
    eventLinkDecided: false,
    isHidden: false,
    isReconciled: false,
    createdBy: null,
    createdAt: "2026-09-04T00:00:00Z",
    updatedAt: "2026-09-04T00:00:00Z",
    ...partial,
  };
}

const lista = [
  tx({ description: "Convênio", amount: 705.52 }),
  tx({ description: "Mercado", amount: 294.48, cardId: "nubank" }),
  tx({ description: "FAPESP Lari", amount: 5790, type: "income" }),
  tx({ description: "Estorno loja", amount: 50, type: "refund", cardId: "nubank" }),
];

const nbsp = (s: string | null) => (s ?? "").replace(/\s/g, " ");

describe("total do recorte", () => {
  it("o gasto não leva a receita; a receita vem ao lado, em azul", async () => {
    const { TotaisSeparados } = await import("@/components/transactions/totais-separados");
    const s = summarizeMonth(lista, "2026-09");
    render(<TotaisSeparados gastoCents={s.spentCents} recebidoCents={s.incomeCents} />);

    const gasto = screen.getByText("Gastos").nextElementSibling!;
    expect(nbsp(gasto.textContent)).toBe("R$ 950,00");
    expect(gasto.className).toContain("text-danger");

    const recebido = screen.getByText("Recebido").nextElementSibling!;
    expect(nbsp(recebido.textContent)).toBe("+R$ 5.790,00");
    expect(recebido.className).toContain("text-info");
  });

  it("sem receita no recorte, só o gasto", async () => {
    const { TotaisSeparados } = await import("@/components/transactions/totais-separados");
    render(<TotaisSeparados gastoCents={12_345} recebidoCents={0} />);
    expect(screen.getByText("Gastos")).toBeTruthy();
    expect(screen.queryByText("Recebido")).toBeNull();
  });
});

describe("lista de lançamentos", () => {
  it("gasto em vermelho, receita em azul com +, estorno em verde", async () => {
    const { TransactionList } = await import("@/components/transactions/transaction-list");
    render(<TransactionList transactions={lista} categories={[]} cards={[]} members={[]} defaultMonth="2026-09" />);

    const valor = (descricao: string) => {
      const linha = screen.getByText(descricao).closest("li")!;
      return within(linha).getByText(/R\$/);
    };
    expect(valor("Convênio").className).toContain("text-danger");
    expect(valor("FAPESP Lari").className).toContain("text-info");
    expect(nbsp(valor("FAPESP Lari").textContent)).toBe("+R$ 5.790,00");
    expect(valor("Estorno loja").className).toContain("text-positive");
  });

  it("pagamento da fatura diz que não soma, sem seletor de categoria", async () => {
    const { TransactionList } = await import("@/components/transactions/transaction-list");
    render(
      <TransactionList
        transactions={[tx({ description: "Inclusao de Pagamento", amount: 4473.37, type: "payment", origin: "invoice" })]}
        categories={[]}
        cards={[]}
        members={[]}
        defaultMonth="2026-09"
      />,
    );
    const linha = screen.getByText("Inclusao de Pagamento").closest("li")!;
    expect(within(linha).getByText(/Não soma nos gastos/)).toBeTruthy();
    expect(within(linha).queryByText("Sem categoria")).toBeNull();
    expect(summarizeMonth([tx({ type: "payment", amount: 4473.37 })], "2026-09").spentCents).toBe(0);
  });
});
