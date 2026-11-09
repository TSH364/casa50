import { beforeEach, describe, expect, it, vi } from "vitest";
import { limitesDoMes } from "@/domain/finance";
import type { Budget } from "@/domain/types";

/**
 * Limite de gasto nas categorias - pedido da casa: "falta a opcao de
 * adicionar limite de gastos as categorias".
 *
 * O que guarda: o limite vale do mes em que foi definido em diante, ate ser
 * mudado; um mes com limite proprio nao mexe nos outros; tirar o limite
 * grava zero so quando um limite anterior voltaria a valer. A tela esta em
 * `limite-categorias-tela.test.tsx`.
 */

const b = (categoryId: string, month: string, limitAmount: number): Budget => ({
  id: `${categoryId}-${month}`,
  houseId: "c",
  categoryId,
  month,
  limitAmount,
});

describe("limitesDoMes", () => {
  const todos = [b("mer", "2026-09", 1500), b("mer", "2026-11", 1800), b("laz", "2026-10", 600), b("laz", "2026-12", 0), b("del", "2027-01", 300)];

  it("o limite segue valendo nos meses seguintes, com o mês pedido", () => {
    expect(limitesDoMes(todos, "2026-10")).toEqual([
      { ...b("mer", "2026-09", 1500), month: "2026-10" },
      { ...b("laz", "2026-10", 600), month: "2026-10" },
    ]);
  });

  it("o mais recente até o mês vence; o de um mês depois não conta", () => {
    const nov = limitesDoMes(todos, "2026-11");
    expect(nov.find((l) => l.categoryId === "mer")!.limitAmount).toBe(1800);
    expect(nov.some((l) => l.categoryId === "del")).toBe(false);
    // Mudar novembro nao mexe em outubro.
    expect(limitesDoMes(todos, "2026-10").find((l) => l.categoryId === "mer")!.limitAmount).toBe(1500);
  });

  it("zero é “sem limite daqui em diante”", () => {
    const dez = limitesDoMes(todos, "2026-12");
    expect(dez.some((l) => l.categoryId === "laz")).toBe(false);
    expect(limitesDoMes(todos, "2026-11").some((l) => l.categoryId === "laz")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tirar o limite (setBudget com zero), com o banco simulado
// ---------------------------------------------------------------------------

type Chamada = { tabela: string; operacao: string; payload: unknown; filtros: [string, unknown][] };
const estado = { chamadas: [] as Chamada[], anteriores: [] as Record<string, unknown>[], erroNoZero: null as null | { code: string } };

function tabela(nome: string) {
  const chamada: Chamada = { tabela: nome, operacao: "select", payload: null, filtros: [] };
  const resolver = () => {
    estado.chamadas.push(chamada);
    if (chamada.operacao === "upsert") {
      const zero = (chamada.payload as { limit_amount: number }[]).some((p) => p.limit_amount === 0);
      return { data: null, error: zero ? estado.erroNoZero : null };
    }
    if (chamada.operacao !== "select") return { data: null, error: null };
    return { data: estado.anteriores, error: null };
  };
  const q: Record<string, unknown> = {};
  for (const m of ["eq", "lt", "lte", "in"]) {
    q[m] = (campo: string, valor: unknown) => {
      chamada.filtros.push([`${m}:${campo}`, valor]);
      return q;
    };
  }
  q.select = () => q;
  for (const op of ["insert", "update", "upsert", "delete"]) {
    q[op] = (p: unknown) => {
      chamada.operacao = op;
      chamada.payload = p;
      return q;
    };
  }
  q.then = (ok: (r: unknown) => unknown) => Promise.resolve(resolver()).then(ok);
  return q;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));

const MER = "00000000-0000-4000-8000-000000000001";
const ops = (op: string) => estado.chamadas.filter((c) => c.tabela === "budgets" && c.operacao === op);

describe("tirar o limite", () => {
  beforeEach(() => {
    estado.chamadas.length = 0;
    estado.anteriores = [];
    estado.erroNoZero = null;
  });

  it("sem limite anterior: só apaga o do mês", async () => {
    const { setBudget } = await import("@/actions/budgets");
    const r = await setBudget({ categoryId: MER, month: "2026-11", limitCents: 0 });
    expect(r.ok).toBe(true);
    expect(ops("delete")).toHaveLength(1);
    expect(ops("upsert")).toHaveLength(0);
  });

  it("com limite de um mês anterior: grava zero no mês, para ele não voltar", async () => {
    estado.anteriores = [{ id: "x", house_id: "casa-1", category_id: MER, month: "2026-09-01", limit_amount: 1500 }];
    const { setBudget } = await import("@/actions/budgets");
    const r = await setBudget({ categoryId: MER, month: "2026-11", limitCents: 0 });
    expect(r.ok).toBe(true);
    expect(ops("upsert")[0]!.payload).toEqual([
      { house_id: "casa-1", category_id: MER, month: "2026-11-01", limit_amount: 0, created_by: "user-1" },
    ]);
  });

  it("banco sem a atualização (zero recusado): diz o que falta", async () => {
    estado.anteriores = [{ id: "x", house_id: "casa-1", category_id: MER, month: "2026-09-01", limit_amount: 1500 }];
    estado.erroNoZero = { code: "23514" };
    const { setBudget } = await import("@/actions/budgets");
    const r = await setBudget({ categoryId: MER, month: "2026-11", limitCents: 0 });
    expect(r.error).toMatch(/falta aplicar a atualização do banco/);
  });
});
