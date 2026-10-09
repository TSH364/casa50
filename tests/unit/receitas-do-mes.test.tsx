import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { dataDoModelo, faltamNoMes, modelosDeReceita } from "@/domain/receitas-do-mes";
import type { Transaction } from "@/domain/types";

/**
 * Receitas de todo mes - pedido da casa: "o salario, que e praticamente igual
 * todo mes, poderia ter a opcao de ja preencher automatico".
 *
 * O que guarda: a receita que se repete vira modelo com o ULTIMO lancamento
 * (o salario que subiu vale o novo); a ja lancada no mes - pelo nome ou pelo
 * valor - nao aparece como faltando; o dia cabe no mes; o atalho do
 * formulario preenche os campos; e o "Lancar" de uma que falta abre o
 * formulario ja preenchido, no mes da tela.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/extratos",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/transactions", () => ({ createTransaction: vi.fn(), updateTransaction: vi.fn() }));
vi.mock("@/actions/jev", () => ({ suggestCategoryFromText: vi.fn(async () => ({})) }));

afterEach(() => vi.useRealTimers());

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  seq += 1;
  return {
    id: `t${seq}`, houseId: "c", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: `${p.invoiceMonth ?? "2026-09"}-05`, invoiceMonth: "2026-09", description: "Compra",
    merchantOriginal: null, merchantNormalized: null, merchantAlias: null, amount: 100, currency: "BRL",
    originalAmount: null, originalCurrency: null, type: "income", origin: "manual", status: "confirmed",
    categoryId: null, subcategoryId: null, note: null, receiptUrl: null, visibility: "shared",
    splitType: "none", splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null,
    calendarEventId: null, eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null,
    createdAt: "", updatedAt: "", ...p,
  };
}

const historico = [
  tx({ description: "Salário Vini", invoiceMonth: "2026-07", date: "2026-07-05", amount: 8000, categoryId: "salario", memberId: "vini" }),
  tx({ description: "Salário Vini", invoiceMonth: "2026-08", date: "2026-08-05", amount: 8000, categoryId: "salario", memberId: "vini" }),
  tx({ description: "Salário Vini", invoiceMonth: "2026-09", date: "2026-09-04", amount: 8500, categoryId: "salario", memberId: "vini" }),
  tx({ description: "FAPESP Lari", invoiceMonth: "2026-08", date: "2026-08-31", amount: 5790, memberId: "lari" }),
  tx({ description: "FAPESP Lari", invoiceMonth: "2026-09", date: "2026-09-30", amount: 5790, memberId: "lari" }),
  tx({ description: "Freela site", invoiceMonth: "2026-09", amount: 1200 }),
];

describe("modelos", () => {
  it("só o que se repete, com o último lançamento", () => {
    const m = modelosDeReceita(historico, "2026-10");
    expect(m.map((x) => [x.description, x.amount, x.dia, x.categoryId, x.memberId])).toEqual([
      ["Salário Vini", 8500, 4, "salario", "vini"],
      ["FAPESP Lari", 5790, 30, null, "lari"],
    ]);
  });

  it("a já lançada no mês não falta - pelo nome ou por valor parecido com outro nome", () => {
    const modelos = modelosDeReceita(historico, "2026-10");
    const outubro = [...historico, tx({ description: "Bolsa", invoiceMonth: "2026-10", amount: 5790 })];
    expect(faltamNoMes(modelos, outubro, "2026-10").map((x) => x.description)).toEqual(["Salário Vini"]);
    const comSalario = [...outubro, tx({ description: "Salário Vini", invoiceMonth: "2026-10", amount: 8500 })];
    expect(faltamNoMes(modelos, comSalario, "2026-10")).toEqual([]);
  });

  it("o dia cabe no mês", () => {
    expect(dataDoModelo({ dia: 30 }, "2027-02")).toBe("2027-02-28");
    expect(dataDoModelo({ dia: 4 }, "2026-03")).toBe("2026-03-04");
  });
});

describe("no formulário", () => {
  const modelos = modelosDeReceita(historico, "2026-10");

  it("Receita mostra os atalhos, e um toque preenche nome, valor e data no mês da tela", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 9, 12));
    const { TransactionFormDialog } = await import("@/components/transactions/transaction-form");
    render(
      <TransactionFormDialog open onOpenChange={() => {}} categories={[]} cards={[]} members={[]} defaultMonth="2026-03" modelos={modelos} />,
    );
    // Num gasto, os atalhos de receita nao aparecem.
    expect(screen.queryByText(/Preencher com/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Receita" }));
    fireEvent.click(screen.getByRole("button", { name: /Salário Vini/ }));
    expect((screen.getByLabelText("Descrição") as HTMLInputElement).value).toBe("Salário Vini");
    expect((screen.getByLabelText("Valor") as HTMLInputElement).value).toBe("8500");
    expect((screen.getByLabelText("Data em que entrou") as HTMLInputElement).value).toBe("2026-03-04");
  });

  it("o Lançar de uma que falta abre já preenchido", async () => {
    const { ReceitasQueFaltam } = await import("@/components/transactions/receitas-que-faltam");
    render(
      <ReceitasQueFaltam faltam={[modelos[1]!]} modelos={modelos} month="2026-02" categories={[]} cards={[]} members={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Lançar FAPESP Lari/ }));
    expect((screen.getByLabelText("Descrição") as HTMLInputElement).value).toBe("FAPESP Lari");
    expect((screen.getByLabelText("Valor") as HTMLInputElement).value).toBe("5790");
    expect((screen.getByLabelText("Data em que entrou") as HTMLInputElement).value).toBe("2026-02-28");
    expect(screen.getByRole("radio", { name: "Receita" }).getAttribute("aria-checked")).toBe("true");
  });

  it("nada faltando, nada aparece", async () => {
    const { ReceitasQueFaltam } = await import("@/components/transactions/receitas-que-faltam");
    const { container } = render(
      <ReceitasQueFaltam faltam={[]} modelos={modelos} month="2026-10" categories={[]} cards={[]} members={[]} />,
    );
    expect(container.textContent).toBe("");
  });
});
