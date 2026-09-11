import { describe, expect, it } from "vitest";
import { rebalancePlan, type CategoryBudgetState } from "@/domain/rebalance";

function estado(overrides: Partial<CategoryBudgetState> & { categoryId: string }): CategoryBudgetState {
  return {
    limitCents: 0,
    spentCents: 0,
    typicalCents: 0,
    committedCents: 0,
    ...overrides,
  };
}

describe("rebalancePlan", () => {
  it("o caso do enunciado: alimentação de R$ 1.000 para R$ 800", () => {
    const plano = rebalancePlan(
      [
        estado({
          categoryId: "alimentacao",
          limitCents: 100_000,
          typicalCents: 95_000,
        }),
      ],
      20_000,
    );

    expect(plano.proposals).toHaveLength(1);
    expect(plano.proposals[0]).toMatchObject({
      categoryId: "alimentacao",
      fromCents: 100_000,
      toCents: 80_000,
      freedCents: 20_000,
    });
    expect(plano.shortfallCents).toBe(0);
  });

  it("tira a folga antes de cortar de verdade", () => {
    const plano = rebalancePlan(
      [
        // Limite bem acima do que a casa costuma gastar: R$ 200 de folga.
        estado({ categoryId: "lazer", limitCents: 50_000, typicalCents: 30_000 }),
        estado({ categoryId: "alimentacao", limitCents: 100_000, typicalCents: 95_000 }),
      ],
      20_000,
    );

    expect(plano.proposals).toHaveLength(1);
    expect(plano.proposals[0]).toMatchObject({
      categoryId: "lazer",
      toCents: 30_000,
      reason: "slack",
    });
    // Alimentação nem foi tocada.
    expect(plano.untouched.map((u) => u.categoryId)).toContain("alimentacao");
  });

  it("nunca propõe limite abaixo do que já foi gasto", () => {
    const plano = rebalancePlan(
      [
        estado({
          categoryId: "alimentacao",
          limitCents: 100_000,
          spentCents: 90_000,
          typicalCents: 95_000,
        }),
      ],
      50_000,
    );

    expect(plano.proposals[0]?.toCents).toBe(90_000);
    // O que não coube fica dito, não escondido.
    expect(plano.shortfallCents).toBe(40_000);
  });

  it("não corta o que já está assinado", () => {
    const plano = rebalancePlan(
      [
        estado({
          categoryId: "moradia",
          limitCents: 200_000,
          typicalCents: 200_000,
          committedCents: 190_000,
        }),
        estado({ categoryId: "lazer", limitCents: 60_000, typicalCents: 40_000 }),
      ],
      50_000,
    );

    const moradia = plano.proposals.find((p) => p.categoryId === "moradia");
    // Pode devolver a folga acima do compromisso, nunca o compromisso.
    expect(moradia?.toCents ?? 200_000).toBeGreaterThanOrEqual(190_000);

    const lazer = plano.proposals.find((p) => p.categoryId === "lazer");
    expect(lazer).toBeDefined();
    expect(lazer!.freedCents).toBeGreaterThan(0);
  });

  it("nenhuma categoria cede mais de 40% do que costuma gastar", () => {
    const plano = rebalancePlan(
      [estado({ categoryId: "alimentacao", limitCents: 100_000, typicalCents: 100_000 })],
      90_000,
    );

    expect(plano.proposals[0]?.toCents).toBe(60_000);
    expect(plano.shortfallCents).toBe(50_000);
  });

  it("os limites propostos são redondos", () => {
    const plano = rebalancePlan(
      [estado({ categoryId: "alimentacao", limitCents: 100_000, typicalCents: 87_300 })],
      15_000,
    );

    const proposto = plano.proposals[0]!.toCents;
    expect(proposto % 1_000).toBe(0);
    expect(plano.freedCents).toBeGreaterThanOrEqual(15_000);
  });

  it("concentra o corte em vez de espalhar migalhas", () => {
    const plano = rebalancePlan(
      [
        estado({ categoryId: "a", limitCents: 100_000, typicalCents: 100_000 }),
        estado({ categoryId: "b", limitCents: 100_000, typicalCents: 100_000 }),
        estado({ categoryId: "c", limitCents: 100_000, typicalCents: 100_000 }),
      ],
      20_000,
    );

    // Uma decisão de R$ 200, não três de R$ 66,67.
    expect(plano.proposals).toHaveLength(1);
    expect(plano.proposals[0]?.freedCents).toBe(20_000);
  });

  it("sem necessidade, não propõe nada", () => {
    const plano = rebalancePlan(
      [estado({ categoryId: "a", limitCents: 100_000, typicalCents: 50_000 })],
      0,
    );
    expect(plano.proposals).toEqual([]);
    expect(plano.shortfallCents).toBe(0);
  });

  it("sem orçamento cadastrado, não há o que realocar", () => {
    const plano = rebalancePlan([], 20_000);
    expect(plano.proposals).toEqual([]);
    expect(plano.shortfallCents).toBe(20_000);
  });
});
