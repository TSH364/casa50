import type { Cents } from "@/lib/money";

/**
 * O quadro de tarefas da casa (secao 17), estilo Trello.
 *
 * Colunas que a casa cria, tarefas dentro delas. Uma tarefa pode ter valor
 * PREVISTO e lancamentos reais LIGADOS: o gasto e a soma deles, lida na hora
 * - nunca copiada -, para o quadro e o extrato nunca discordarem.
 *
 * Puro: montar o quadro, reordenar, e dizer como esta o previsto x gasto.
 */

export interface TaskList {
  id: string;
  name: string;
  position: number;
}

export interface LinkedTransaction {
  id: string;
  date: string;
  label: string;
  /** Quanto o lancamento pesa no gasto (estorno negativo), em centavos. */
  cents: Cents;
}

export interface Task {
  id: string;
  listId: string;
  title: string;
  notes: string | null;
  position: number;
  memberId: string | null;
  isJoint: boolean;
  dueDate: string | null;
  expectedCents: Cents | null;
  done: boolean;
  linked: LinkedTransaction[];
}

export interface BoardColumn extends TaskList {
  tasks: Task[];
}

/** Colunas na ordem, cada uma com as tarefas na ordem. */
export function buildBoard(lists: readonly TaskList[], tasks: readonly Task[]): BoardColumn[] {
  const porLista = new Map<string, Task[]>();
  for (const t of tasks) porLista.set(t.listId, [...(porLista.get(t.listId) ?? []), t]);
  return [...lists]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((l) => ({
      ...l,
      tasks: (porLista.get(l.id) ?? []).sort((a, b) => a.position - b.position),
    }));
}

/**
 * As posicoes de uma coluna depois de pôr `taskId` no indice `index`.
 *
 * Devolve a lista inteira renumerada 0..n-1 - so muda o que precisa, mas
 * renumerar tudo evita as posicoes repetidas que deixariam a ordem ao acaso.
 * Indice fora da faixa vai para a ponta mais proxima.
 */
export function reorder(
  columnTaskIds: readonly string[],
  taskId: string,
  index: number,
): { id: string; position: number }[] {
  const sem = columnTaskIds.filter((id) => id !== taskId);
  const i = Math.max(0, Math.min(Math.trunc(index), sem.length));
  sem.splice(i, 0, taskId);
  return sem.map((id, position) => ({ id, position }));
}

/** O mesmo, para as colunas do quadro: mover uma coluna uma casa para o lado. */
export function moveColumn(
  listIds: readonly string[],
  listId: string,
  direction: -1 | 1,
): { id: string; position: number }[] {
  const i = listIds.indexOf(listId);
  const novo = [...listIds];
  const j = i + direction;
  if (i >= 0 && j >= 0 && j < novo.length) [novo[i], novo[j]] = [novo[j]!, novo[i]!];
  return novo.map((id, position) => ({ id, position }));
}

export interface TaskMoney {
  spentCents: Cents;
  expectedCents: Cents | null;
  /** Gasto passou do previsto. */
  over: boolean;
  /** 0 a 1 (ou mais, se passou), quando ha previsto. */
  ratio: number | null;
}

export function taskMoney(t: Pick<Task, "linked" | "expectedCents">): TaskMoney {
  const spentCents = t.linked.reduce((s, l) => s + l.cents, 0);
  const expected = t.expectedCents;
  return {
    spentCents,
    expectedCents: expected,
    over: expected !== null && spentCents > expected,
    ratio: expected !== null && expected > 0 ? spentCents / expected : null,
  };
}

/** Prazo vencido: antes de hoje e ainda nao feita. */
export function isOverdue(t: Pick<Task, "dueDate" | "done">, todayIso: string): boolean {
  return !t.done && t.dueDate !== null && t.dueDate < todayIso;
}

/** As colunas com que um quadro novo comeca - a casa renomeia se quiser. */
export const DEFAULT_LISTS = ["A fazer", "Fazendo", "Feito"] as const;
