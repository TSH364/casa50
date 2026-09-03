import { describe, expect, it } from "vitest";
import { monthSettlement } from "@/domain/settlement";
import type { Transaction } from "@/domain/types";

const VINI = "user-vini";
const LARI = "user-lari";

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    houseId: "casa",
    invoiceId: null,
    cardId: null,
    memberId: VINI,
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

const membros = [VINI, LARI];

describe("monthSettlement", () => {
  it("divide meio a meio quando um paga tudo", () => {
    const s = monthSettlement(
      [tx({ memberId: VINI, amount: 1000 })],
      membros,
      "2026-08",
    );

    expect(s.sharedCents).toBe(100000);
    expect(s.transfers).toHaveLength(1);
    expect(s.transfers[0]).toEqual({
      fromMemberId: LARI,
      toMemberId: VINI,
      amountCents: 50000,
    });
  });

  it("reconhece quando já está empatado", () => {
    const s = monthSettlement(
      [
        tx({ memberId: VINI, amount: 500 }),
        tx({ memberId: LARI, amount: 500 }),
      ],
      membros,
      "2026-08",
    );

    expect(s.isBalanced).toBe(true);
    expect(s.transfers).toHaveLength(0);
  });

  it("acerta a diferença quando os dois gastam", () => {
    const s = monthSettlement(
      [
        tx({ memberId: VINI, amount: 800 }),
        tx({ memberId: LARI, amount: 200 }),
      ],
      membros,
      "2026-08",
    );

    // Total 1000, cada um deve 500. Lari pagou 200, deve 300.
    expect(s.transfers[0]?.amountCents).toBe(30000);
    expect(s.transfers[0]?.fromMemberId).toBe(LARI);
  });

  it("não divide lançamento individual", () => {
    // O que é individual é de quem gastou e não entra na conta do outro.
    const s = monthSettlement(
      [
        tx({ memberId: VINI, amount: 1000, visibility: "individual" }),
        tx({ memberId: VINI, amount: 100 }),
      ],
      membros,
      "2026-08",
    );

    expect(s.sharedCents).toBe(10000);
    expect(s.transfers[0]?.amountCents).toBe(5000);
  });

  it("separa o que não tem responsável em vez de chutar", () => {
    // Atribuir ao acaso daria um acerto errado com cara de exato.
    const s = monthSettlement(
      [
        tx({ memberId: VINI, amount: 100 }),
        tx({ memberId: null, amount: 900 }),
      ],
      membros,
      "2026-08",
    );

    expect(s.sharedCents).toBe(10000);
    expect(s.unassignedCents).toBe(90000);
    expect(s.unassignedCount).toBe(1);
  });

  it("estorno abate o que a pessoa pagou", () => {
    const s = monthSettlement(
      [
        tx({ memberId: VINI, amount: 1000 }),
        tx({ memberId: VINI, amount: 400, type: "refund" }),
      ],
      membros,
      "2026-08",
    );

    // Vini pagou 600 líquidos; cada um deve 300.
    expect(s.sharedCents).toBe(60000);
    expect(s.transfers[0]?.amountCents).toBe(30000);
  });

  it("ignora pagamento de fatura", () => {
    // Pagar a fatura não é despesa: é quitação. Contar aqui dobraria o gasto.
    const s = monthSettlement(
      [
        tx({ memberId: VINI, amount: 100 }),
        tx({ memberId: VINI, amount: 5000, type: "payment" }),
      ],
      membros,
      "2026-08",
    );
    expect(s.sharedCents).toBe(10000);
  });

  it("ignora outro mês", () => {
    const s = monthSettlement(
      [tx({ memberId: VINI, amount: 1000, invoiceMonth: "2026-07" })],
      membros,
      "2026-08",
    );
    expect(s.sharedCents).toBe(0);
    expect(s.isBalanced).toBe(true);
  });

  it("ignora lançamento oculto", () => {
    const s = monthSettlement(
      [tx({ memberId: VINI, amount: 1000, isHidden: true })],
      membros,
      "2026-08",
    );
    expect(s.sharedCents).toBe(0);
  });

  it("não perde centavo em divisão inexata", () => {
    // R$ 10,01 entre dois: 501 + 500. A soma das partes precisa bater com o
    // total, senão o acerto deixa um centavo órfão todo mês.
    const s = monthSettlement(
      [tx({ memberId: VINI, amount: 10.01 })],
      membros,
      "2026-08",
    );

    const somaDasPartes = s.balances.reduce((sum, b) => sum + b.shareCents, 0);
    expect(somaDasPartes).toBe(1001);
  });

  it("divide entre três sem perder centavo", () => {
    const TERCEIRO = "user-3";
    const s = monthSettlement(
      [tx({ memberId: VINI, amount: 10 })],
      [VINI, LARI, TERCEIRO],
      "2026-08",
    );

    const somaDasPartes = s.balances.reduce((sum, b) => sum + b.shareCents, 0);
    expect(somaDasPartes).toBe(1000);
    // Saldos sempre somam zero: ninguém some com dinheiro.
    const somaDosSaldos = s.balances.reduce((sum, b) => sum + b.balanceCents, 0);
    expect(somaDosSaldos).toBe(0);
  });

  it("respeita pesos na divisão proporcional", () => {
    // Renda 70/30: quem ganha mais banca mais.
    const s = monthSettlement(
      [tx({ memberId: VINI, amount: 1000 })],
      membros,
      "2026-08",
      { weights: { [VINI]: 70, [LARI]: 30 } },
    );

    expect(s.balances.find((b) => b.memberId === VINI)?.shareCents).toBe(70000);
    expect(s.balances.find((b) => b.memberId === LARI)?.shareCents).toBe(30000);
    expect(s.transfers[0]?.amountCents).toBe(30000);
  });

  it("resolve três pessoas com um mínimo de transferências", () => {
    const TERCEIRO = "user-3";
    const s = monthSettlement(
      [
        tx({ memberId: VINI, amount: 900 }),
        tx({ memberId: LARI, amount: 0.03 }),
      ],
      [VINI, LARI, TERCEIRO],
      "2026-08",
    );

    // Duas pessoas devem, uma tem a receber: duas transferências bastam.
    expect(s.transfers).toHaveLength(2);
    expect(s.transfers.every((t) => t.toMemberId === VINI)).toBe(true);
  });
});
