import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBoard, isOverdue, moveColumn, reorder, taskMoney, type Task } from "@/domain/tasks";

/**
 * O quadro de tarefas (secao 17).
 *
 * O que guarda: a ordem das colunas e das tarefas, o reposicionar sem
 * posicoes repetidas, o previsto x gasto com estorno descontando, o prazo
 * vencido; e, nas acoes, que tudo vai filtrado pela casa, que "os dois" nao
 * leva pessoa junto, e que quem nao e da casa nao vira responsavel.
 */

function tarefa(p: Partial<Task> = {}): Task {
  return {
    id: "t",
    listId: "a",
    title: "Tarefa",
    notes: null,
    position: 0,
    memberId: null,
    isJoint: false,
    dueDate: null,
    expectedCents: null,
    done: false,
    linked: [],
    ...p,
  };
}

describe("buildBoard", () => {
  it("colunas e tarefas na ordem de position; coluna vazia continua no quadro", () => {
    const b = buildBoard(
      [
        { id: "b", name: "Feito", position: 2 },
        { id: "a", name: "A fazer", position: 0 },
        { id: "c", name: "Fazendo", position: 1 },
      ],
      [tarefa({ id: "2", listId: "a", position: 1 }), tarefa({ id: "1", listId: "a", position: 0 })],
    );
    expect(b.map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(b[0]!.tasks.map((t) => t.id)).toEqual(["1", "2"]);
    expect(b[1]!.tasks).toEqual([]);
  });
});

describe("reorder", () => {
  it("renumera 0..n-1 com a tarefa no novo lugar", () => {
    expect(reorder(["a", "b", "c"], "c", 0)).toEqual([
      { id: "c", position: 0 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ]);
  });

  it("tarefa vinda de outra coluna entra; indice fora da faixa vai para a ponta", () => {
    expect(reorder(["a", "b"], "x", 99).map((p) => p.id)).toEqual(["a", "b", "x"]);
    expect(reorder(["a", "b"], "x", -3).map((p) => p.id)).toEqual(["x", "a", "b"]);
  });
});

describe("moveColumn", () => {
  it("troca com a vizinha; na ponta, nada muda", () => {
    expect(moveColumn(["a", "b", "c"], "b", 1).map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(moveColumn(["a", "b", "c"], "a", -1).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

describe("taskMoney", () => {
  it("gasto é a soma dos ligados, estorno desconta; passa do previsto", () => {
    const m = taskMoney({
      expectedCents: 25_000,
      linked: [
        { id: "1", date: "2026-09-01", label: "Loja", cents: 30_000 },
        { id: "2", date: "2026-09-02", label: "Loja", cents: -2_000 },
      ],
    });
    expect(m.spentCents).toBe(28_000);
    expect(m.over).toBe(true);
    expect(m.ratio).toBeCloseTo(1.12);
  });

  it("sem previsto, sem proporção", () => {
    expect(taskMoney({ expectedCents: null, linked: [] })).toMatchObject({ ratio: null, over: false });
  });
});

describe("isOverdue", () => {
  it("antes de hoje e não feita", () => {
    expect(isOverdue({ dueDate: "2026-09-25", done: false }, "2026-09-26")).toBe(true);
    expect(isOverdue({ dueDate: "2026-09-26", done: false }, "2026-09-26")).toBe(false);
    expect(isOverdue({ dueDate: "2026-09-25", done: true }, "2026-09-26")).toBe(false);
    expect(isOverdue({ dueDate: null, done: false }, "2026-09-26")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const VINI = "11111111-1111-4111-8111-111111111111";
const FORA = "99999999-9999-4999-8999-999999999999";
const TAREFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COLUNA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LANC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

interface Chamada {
  tabela: string;
  op: string;
  valores?: unknown;
  filtros: [string, unknown][];
}

const estado = {
  chamadas: [] as Chamada[],
  erro: null as { code: string } | null,
  linhas: [] as Record<string, unknown>[],
};

function tabela(nome: string) {
  const c: Chamada = { tabela: nome, op: "select", filtros: [] };
  estado.chamadas.push(c);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in"]) b[m] = () => b;
  b.eq = (col: string, v: unknown) => {
    c.filtros.push([col, v]);
    return b;
  };
  for (const op of ["insert", "update", "upsert"]) {
    b[op] = (v: unknown) => {
      c.op = op;
      c.valores = v;
      return b;
    };
  }
  b.delete = () => {
    c.op = "delete";
    return b;
  };
  let uma = false;
  b.single = () => b;
  b.maybeSingle = () => {
    uma = true;
    return b;
  };
  b.then = (ok: (r: unknown) => unknown) =>
    Promise.resolve({
      data:
        c.op === "select"
          ? uma
            ? (estado.linhas[0] ?? null)
            : estado.linhas
          : c.op === "insert"
            ? { id: TAREFA }
            : null,
      error: c.op === "select" ? null : estado.erro,
      count: 0,
    }).then(ok);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/data/queries", () => ({ listTransactions: async () => [] }));
vi.mock("@/lib/houses", () => ({
  listMembers: async () => [{ userId: VINI, fullName: "Vinicius Roselli", email: "", role: "owner" }],
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: VINI }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));

const acoes = await import("@/actions/tasks");

const base = {
  id: TAREFA,
  title: "Consertar o chuveiro",
  notes: null,
  who: "",
  dueDate: null,
  expectedCents: 25_000,
  done: false,
};

describe("ações do quadro", () => {
  beforeEach(() => {
    estado.chamadas = [];
    estado.erro = null;
    estado.linhas = [];
  });

  it("toda escrita vai filtrada pela casa", async () => {
    await acoes.updateTask(base);
    await acoes.deleteTask({ id: TAREFA });
    await acoes.renameList({ id: COLUNA, name: "Pronto" });
    await acoes.unlinkTransaction({ taskId: TAREFA, transactionId: LANC });
    const escritas = estado.chamadas.filter((c) => c.op !== "select");
    expect(escritas).toHaveLength(4);
    for (const c of escritas) expect(c.filtros).toContainEqual(["house_id", "casa-1"]);
  });

  it("previsto vai em reais; 'os dois' não leva pessoa", async () => {
    await acoes.updateTask({ ...base, who: "dos-dois" });
    const c = estado.chamadas.find((x) => x.op === "update")!;
    expect(c.valores).toMatchObject({ expected_amount: 250, is_joint: true, member_id: null });
  });

  it("quem não é da casa não vira responsável", async () => {
    const r = await acoes.updateTask({ ...base, who: FORA });
    expect(r.error).toMatch(/não é da casa/);
    expect(estado.chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("mover para coluna que não é da casa: frase, e nada muda", async () => {
    estado.linhas = [];
    const r = await acoes.moveTask({ id: TAREFA, listId: COLUNA, index: 0 });
    expect(r.error).toBe("Coluna não encontrada.");
    expect(estado.chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("ligar lançamento de outra casa: a chave composta recusa e vira frase", async () => {
    estado.erro = { code: "23503" };
    const r = await acoes.linkTransaction({ taskId: TAREFA, transactionId: LANC });
    expect(r.error).toBe("Lançamento não encontrado.");
    const c = estado.chamadas.find((x) => x.op === "upsert")!;
    expect(c.valores).toEqual({ house_id: "casa-1", task_id: TAREFA, transaction_id: LANC });
  });

  it("nome vazio não cria coluna", async () => {
    const r = await acoes.createList({ name: "   " });
    expect(r.error).toBeTruthy();
    expect(estado.chamadas).toHaveLength(0);
  });
});
