import { describe, expect, it, vi } from "vitest";
import { recurrencesFor } from "@/domain/forecast";
import type { Recurrence, Transaction } from "@/domain/types";

/**
 * O mapa de fluxo seguindo o filtro por pessoa.
 *
 * O que guarda: o realizado vem com a regra de pessoa (a mesma dos outros
 * cards, via `listTransactions`); a previsao usa as contas fixas dela e as da
 * casa, nunca as do outro; e sem pessoa nada muda.
 */

const VINI = "11111111-1111-4111-8111-111111111111";
const LARI = "22222222-2222-4222-8222-222222222222";

const rec = (o: Partial<Recurrence>): Recurrence => ({
  id: Math.random().toString(36).slice(2), houseId: "casa", description: "x", merchant: "x",
  amount: 100, categoryId: null, cardId: null, ownerId: null, interval: "monthly",
  nextDate: "2026-09-10", expectedDay: 10, isActive: true, offCard: false, source: "manual", ...o,
});

const ALUGUEL = rec({ description: "Aluguel", merchant: "ALUGUEL", amount: 3000 });
const ACADEMIA_VINI = rec({ description: "Academia", merchant: "SMARTFIT", amount: 120, ownerId: VINI });
const CURSO_LARI = rec({ description: "Curso", merchant: "ALURA", amount: 90, ownerId: LARI });

describe("recurrencesFor", () => {
  it("de uma pessoa: as dela e as da casa, nunca as do outro", () => {
    expect(recurrencesFor([ALUGUEL, ACADEMIA_VINI, CURSO_LARI], VINI)).toEqual([ALUGUEL, ACADEMIA_VINI]);
    expect(recurrencesFor([ALUGUEL, ACADEMIA_VINI, CURSO_LARI], LARI)).toEqual([ALUGUEL, CURSO_LARI]);
  });

  it("sem pessoa, todas", () => {
    expect(recurrencesFor([ALUGUEL, ACADEMIA_VINI, CURSO_LARI], null)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------

const pedidos: { memberId?: string | null }[] = [];
const barras: { month: string; cents: number; isForecast: boolean }[][] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/data/queries", () => ({
  listTransactions: async (_h: string, f: { memberId?: string | null }) => {
    pedidos.push(f);
    const t = (amount: number): Transaction =>
      ({ id: String(amount), invoiceMonth: "2026-09", date: "2026-09-05", amount, type: "expense",
         status: "confirmed", isHidden: false, installment: null, merchantNormalized: "LOJA",
         description: "LOJA", categoryId: null } as unknown as Transaction);
    // O banco ja devolve so os da pessoa; o mapa nao filtra de novo.
    return f.memberId === VINI ? [t(200)] : [t(200), t(500)];
  },
  listRecurrences: async () => [ALUGUEL, ACADEMIA_VINI, CURSO_LARI],
}));
vi.mock("@/components/dashboard/flow-bars", () => ({
  FlowBars: ({ bars }: { bars: (typeof barras)[number] }) => {
    barras.push(bars);
    return null;
  },
}));

describe("FlowMap", () => {
  it("com pessoa: pede os lançamentos dela, e diz de quem é o mapa", async () => {
    const { FlowMap } = await import("@/components/dashboard/flow-map");
    pedidos.length = 0;
    barras.length = 0;
    const el = await FlowMap({ houseId: "casa", month: "2026-09", excludeCategoryIds: [], memberId: VINI, memberName: "Vinicius" });
    expect(pedidos[0]?.memberId).toBe(VINI);
    expect(JSON.stringify(el)).toMatch(/Só de Vinicius/);

    const { render } = await import("@testing-library/react");
    render(el);
    const setembro = barras[0]!.find((b) => b.month === "2026-09" && !b.isForecast)!;
    expect(setembro.cents).toBe(20_000);
  });

  it("a previsão de cada um soma as contas dele e as da casa — e só elas", async () => {
    const { FlowMap } = await import("@/components/dashboard/flow-map");
    const { render } = await import("@testing-library/react");
    const outubro = async (memberId: string) => {
      barras.length = 0;
      render(await FlowMap({ houseId: "casa", month: "2026-09", excludeCategoryIds: [], memberId, memberName: "x" }));
      return barras[0]!.find((b) => b.month === "2026-10")!.cents;
    };
    // Pouco historico: sem estimativa de variavel, a previsao e so o
    // compromissado - aluguel da casa + a conta fixa de cada um.
    expect(await outubro(VINI)).toBe((3000 + 120) * 100);
    expect(await outubro(LARI)).toBe((3000 + 90) * 100);
  });

  it("sem pessoa: a casa toda, como antes", async () => {
    const { FlowMap } = await import("@/components/dashboard/flow-map");
    pedidos.length = 0;
    await FlowMap({ houseId: "casa", month: "2026-09", excludeCategoryIds: [] });
    expect(pedidos[0]?.memberId ?? null).toBeNull();
  });
});
