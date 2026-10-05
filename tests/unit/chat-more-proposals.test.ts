import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartSpec, Proposal } from "@/domain/chat";
import type { ShoppingSearch } from "@/domain/shopping";
import type { BoardColumn } from "@/domain/tasks";
import type { Transaction } from "@/domain/types";

/**
 * Mais pedidos na Conversa: metas, orcamentos, contas fixas e tarefas.
 *
 * O que guarda: as ferramentas so PROPOEM (nada gravado); orcamento so em
 * categoria principal, com o limite atual e a media no cartao; tarefa pelo
 * codigo, e so o que muda vai na proposta; e a confirmacao passa pelas
 * MESMAS acoes das telas, depois de conferir pessoa e categoria da casa.
 */

const VINI = "11111111-1111-4111-8111-111111111111";
const LARI = "22222222-2222-4222-8222-222222222222";
const MERCADO = "aaaaaaaa-0000-4000-8000-000000000001";
const HORTI = "aaaaaaaa-0000-4000-8000-000000000002";
const T1 = "abcd1234-0000-4000-8000-000000000001";
const COL_A = "c0c00000-0000-4000-8000-00000000000a";
const COL_B = "c0c00000-0000-4000-8000-00000000000b";

const CATS = [
  { id: MERCADO, houseId: "casa-1", name: "Mercado", color: "#0f0", icon: null, parentId: null, isActive: true, kind: "expense" as const, excludedFromTotals: false },
  { id: HORTI, houseId: "casa-1", name: "Hortifruti", color: "#0f0", icon: null, parentId: MERCADO, isActive: true, kind: "expense" as const, excludedFromTotals: false },
];

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(16).slice(2), houseId: "casa-1", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: "2026-08-10", invoiceMonth: "2026-08", description: "x", merchantOriginal: null, merchantNormalized: null,
    merchantAlias: null, amount: 100, currency: "BRL", originalAmount: null, originalCurrency: null, type: "expense",
    origin: "invoice", status: "confirmed", categoryId: MERCADO, subcategoryId: null, note: null, receiptUrl: null,
    visibility: "shared", splitType: "none", splitPercentage: null, installment: null, recurringId: null,
    reconciledWithId: null, calendarEventId: null, eventLinkDecided: false, isHidden: false, isReconciled: false,
    createdBy: null, createdAt: "", updatedAt: "", ...p,
  } as Transaction;
}

const QUADRO: BoardColumn[] = [
  {
    id: COL_A, name: "A fazer", position: 0,
    tasks: [{ id: T1, listId: COL_A, title: "Trocar o chuveiro", notes: "modelo 220v", position: 0, memberId: null, isJoint: false, dueDate: null, expectedCents: 25_000, done: false, linked: [] }],
  },
  { id: COL_B, name: "Feito", position: 1, tasks: [] },
];

const chamadas: { acao: string; args: unknown[] }[] = [];
const registra = (acao: string) => async (...args: unknown[]) => {
  chamadas.push({ acao, args });
  return { ok: true };
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/ai-usage", () => ({ recordAiUsage: async () => {} }));
vi.mock("@/actions/goals", () => ({ createGoal: registra("createGoal") }));
vi.mock("@/actions/budgets", () => ({ setBudget: registra("setBudget") }));
vi.mock("@/actions/recurrences", () => ({ createRecurrence: registra("createRecurrence") }));
vi.mock("@/actions/tasks", () => ({ updateTask: registra("updateTask"), moveTask: registra("moveTask") }));
vi.mock("@/lib/houses", () => ({
  listMembers: async () => [
    { userId: VINI, fullName: "Vinicius Roselli", email: "", role: "owner" },
    { userId: LARI, fullName: "Larissa Souza", email: "", role: "member" },
  ],
}));
vi.mock("@/data/queries", () => ({
  getTaskBoard: async () => QUADRO,
  listBudgets: async () => [{ id: "b", houseId: "casa-1", categoryId: MERCADO, month: "2026-09", limitAmount: 1200 }],
  listTransactions: async () => [
    tx({ invoiceMonth: "2026-06", amount: 1000 }),
    tx({ invoiceMonth: "2026-07", amount: 1300 }),
    tx({ invoiceMonth: "2026-08", amount: 1600 }),
  ],
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: VINI }),
  createClient: async () => ({
    from: (nome: string) => {
      const filtros: unknown[][] = [];
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit"]) b[m] = () => b;
      for (const m of ["eq", "in"]) b[m] = (...a: unknown[]) => { filtros.push([m, ...a]); return b; };
      const dados = () => {
        if (nome === "categories") {
          const ids = (filtros.find((f) => f[0] === "in")?.[2] ?? []) as string[];
          return [{ id: MERCADO, parent_id: null }, { id: HORTI, parent_id: MERCADO }].filter((c) => ids.includes(c.id));
        }
        return [];
      };
      b.maybeSingle = async () => ({
        data:
          nome === "tasks" && filtros.some((f) => f[1] === "id" && f[2] === T1)
            ? { id: T1, list_id: COL_A, title: "Trocar o chuveiro", notes: "modelo 220v", member_id: null, is_joint: false, due_date: null, expected_amount: 250, done: false }
            : null,
        error: null,
      });
      b.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: dados(), error: null }).then(ok);
      return b;
    },
  }),
}));

const { runTool } = await import("@/lib/chat-tools");
const { applyProposal } = await import("@/actions/chat");

const ctx = () => ({
  houseId: "casa-1",
  today: "2026-09",
  todayIso: "2026-09-29",
  members: [
    { userId: VINI, fullName: "Vinicius Roselli", email: "", role: "owner" as const },
    { userId: LARI, fullName: "Larissa Souza", email: "", role: "member" as const },
  ],
  categories: CATS,
  excludeCategoryIds: [],
  proposals: [] as Proposal[],
  charts: [] as ChartSpec[],
  searches: [] as ShoppingSearch[],
});

beforeEach(() => {
  chamadas.length = 0;
});

describe("ferramentas", () => {
  it("meta: propõe com dono, sem gravar; prazo no passado é recusado", async () => {
    const c = ctx();
    await runTool(c, "propor_meta", JSON.stringify({ nome: "Viagem", valor_alvo: 5000, prazo: "2026-12-20", pessoa: "Lari" }));
    expect(c.proposals[0]).toMatchObject({
      kind: "meta",
      fields: { name: "Viagem", targetCents: 500_000, targetDate: "2026-12-20", ownerId: LARI },
      summary: { ownerLabel: "Larissa" },
    });
    const r = await runTool(c, "propor_meta", JSON.stringify({ nome: "X", valor_alvo: 10, prazo: "2026-01-01" }));
    expect(r.output).toMatch(/já passou/);
    expect(chamadas).toHaveLength(0);
  });

  it("orçamento: com limite atual e média; subcategoria é recusada", async () => {
    const c = ctx();
    const r = await runTool(c, "propor_orcamento", JSON.stringify({ categoria: "Mercado", valor: 1500 }));
    expect(c.proposals[0]).toMatchObject({
      kind: "orcamento",
      fields: { categoryId: MERCADO, month: "2026-09", limitCents: 150_000 },
      summary: { currentCents: 120_000, averageCents: 130_000 },
    });
    expect(r.output).toMatch(/Limite atual: R\$\s*1\.200,00/);
    const sub = await runTool(ctx(), "propor_orcamento", JSON.stringify({ categoria: "Hortifruti", valor: 300 }));
    expect(sub.output).toMatch(/subcategoria de Mercado/);
  });

  it("conta fixa: mensal com dia, categoria resolvida", async () => {
    const c = ctx();
    await runTool(c, "propor_conta_fixa", JSON.stringify({ descricao: "Internet", valor: 119.9, dia: 15, categoria: "Mercado", loja: "VIVO" }));
    expect(c.proposals[0]).toMatchObject({
      kind: "conta_fixa",
      fields: { description: "Internet", amountCents: 11_990, interval: "monthly", expectedDay: 15, categoryId: MERCADO, merchant: "VIVO" },
    });
  });

  it("tarefas: lista com código; mudar leva só o que muda", async () => {
    const lista = await runTool(ctx(), "listar_tarefas", "{}");
    expect(lista.output).toMatch(/#abcd1234 Trocar o chuveiro · previsto R\$\s*250,00/);
    const c = ctx();
    await runTool(c, "propor_mudar_tarefa", JSON.stringify({ codigo: "#abcd1234", coluna: "feito", feita: true, pessoa: "os dois" }));
    expect(c.proposals[0]).toMatchObject({
      kind: "mudar_tarefa",
      fields: { taskId: T1, listId: COL_B, done: true, who: "dos-dois" },
      summary: { changes: ["mover para Feito", "marcar como feita", "quem faz: os dois"] },
    });
    expect("dueDate" in (c.proposals[0] as { fields: object }).fields).toBe(false);
  });
});

describe("applyProposal", () => {
  it("meta vai pela ação da tela, em reais; pessoa de fora é recusada", async () => {
    const r = await applyProposal({
      kind: "meta",
      fields: { name: "Viagem", targetCents: 500_000, targetDate: "2026-12-20", monthlyCents: null, ownerId: LARI },
    });
    expect(r.ok).toBe(true);
    const form = chamadas[0]!.args[1] as FormData;
    expect(chamadas[0]!.acao).toBe("createGoal");
    expect(Object.fromEntries(form)).toEqual({ name: "Viagem", targetAmount: "5000,00", targetDate: "2026-12-20", monthlyContribution: "", ownerId: LARI });
    const fora = await applyProposal({
      kind: "meta",
      fields: { name: "X", targetCents: 100, targetDate: null, monthlyCents: null, ownerId: "99999999-9999-4999-8999-999999999999" },
    });
    expect(fora.error).toMatch(/não é da casa/);
    expect(chamadas).toHaveLength(1);
  });

  it("orçamento em subcategoria não passa; na principal, vai para setBudget", async () => {
    expect((await applyProposal({ kind: "orcamento", fields: { categoryId: HORTI, month: "2026-09", limitCents: 100 } })).error).toBeTruthy();
    await applyProposal({ kind: "orcamento", fields: { categoryId: MERCADO, month: "2026-09", limitCents: 150_000 } });
    expect(chamadas.map((c) => c.acao)).toEqual(["setBudget"]);
    expect(chamadas[0]!.args[0]).toEqual({ categoryId: MERCADO, month: "2026-09", limitCents: 150_000 });
  });

  it("conta fixa vai para createRecurrence", async () => {
    await applyProposal({
      kind: "conta_fixa",
      fields: { description: "Internet", merchant: "VIVO", amountCents: 11_990, interval: "monthly", expectedDay: 15, categoryId: MERCADO },
    });
    expect(Object.fromEntries(chamadas[0]!.args[1] as FormData)).toEqual({
      description: "Internet", merchant: "VIVO", amount: "119,90", interval: "monthly", expectedDay: "15", categoryId: MERCADO,
    });
  });

  it("mudar tarefa: mantém o resto, aplica o que muda, e move para o fim da coluna", async () => {
    await applyProposal({ kind: "mudar_tarefa", fields: { taskId: T1, listId: COL_B, done: true, who: "dos-dois" } });
    expect(chamadas.map((c) => c.acao)).toEqual(["updateTask", "moveTask"]);
    expect(chamadas[0]!.args[0]).toEqual({
      id: T1, title: "Trocar o chuveiro", notes: "modelo 220v", who: "dos-dois", dueDate: null, expectedCents: 25_000, done: true,
    });
    expect(chamadas[1]!.args[0]).toMatchObject({ id: T1, listId: COL_B });
  });

  it("tarefa de outra casa: não achada, nada muda", async () => {
    const r = await applyProposal({ kind: "mudar_tarefa", fields: { taskId: "eeeeeeee-0000-4000-8000-000000000009", done: true } });
    expect(r.error).toBe("Tarefa não encontrada.");
    expect(chamadas).toHaveLength(0);
  });
});
