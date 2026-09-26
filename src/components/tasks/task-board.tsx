"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, Check, MoreHorizontal, Plus, Users } from "lucide-react";
import {
  createDefaultBoard,
  createList,
  createTask,
  deleteList,
  moveList,
  moveTask,
  renameList,
  toggleTaskDone,
} from "@/actions/tasks";
import { isOverdue, taskMoney, type BoardColumn, type Task } from "@/domain/tasks";
import { formatCentsCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { TaskDialog } from "./task-dialog";

/**
 * O quadro de tarefas (secao 17).
 *
 * Colunas lado a lado que rolam na horizontal - no celular uma por vez, com a
 * proxima aparecendo na borda para dizer que ha mais. Arrastar entre colunas
 * so no computador (o arrastar do HTML nao existe no toque); no celular, o
 * mesmo movimento fica em "Coluna" e "Posição", dentro da tarefa.
 *
 * O quadro anda na hora e a gravacao vem atras: esperar o servidor para ver o
 * cartao mudar de coluna deixaria o arrastar com cara de travado. Se a
 * gravacao falhar, o aviso aparece e a tela volta ao que o banco tem.
 */

export interface Person {
  id: string;
  name: string;
}

const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Quem faz, em poucas letras, para caber no cartao. */
export function whoLabel(t: Pick<Task, "memberId" | "isJoint">, members: readonly Person[]): string | null {
  if (t.isJoint) return members.length === 2 ? "Os dois" : "Todos";
  return members.find((m) => m.id === t.memberId)?.name ?? null;
}

export function StartBoard() {
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createDefaultBoard();
          if (r.error) toast.error(r.error);
        })
      }
    >
      {pending ? "Criando…" : "Criar o quadro"}
    </Button>
  );
}

/** Tira a tarefa de onde esta e poe na coluna `listId`, no indice `index`. */
function moverLocal(cols: BoardColumn[], taskId: string, listId: string, index: number): BoardColumn[] {
  const task = cols.flatMap((c) => c.tasks).find((t) => t.id === taskId);
  if (!task) return cols;
  return cols.map((c) => {
    const sem = c.tasks.filter((t) => t.id !== taskId);
    if (c.id !== listId) return { ...c, tasks: sem };
    const i = Math.max(0, Math.min(index, sem.length));
    return { ...c, tasks: [...sem.slice(0, i), { ...task, listId }, ...sem.slice(i)] };
  });
}

export function TaskBoard({
  columns,
  members,
  todayIso,
}: {
  columns: BoardColumn[];
  members: Person[];
  todayIso: string;
}) {
  const [cols, setCols] = useState(columns);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [colMenu, setColMenu] = useState<string | null>(null);
  const [, start] = useTransition();

  // O servidor e a verdade: cada resposta nova substitui o que foi feito na mao.
  useEffect(() => setCols(columns), [columns]);

  function mover(taskId: string, listId: string, index: number) {
    setCols((c) => moverLocal(c, taskId, listId, index));
    start(async () => {
      const r = await moveTask({ id: taskId, listId, index });
      if (r.error) {
        toast.error(r.error);
        setCols(columns);
      }
    });
  }

  function marcar(t: Task) {
    setCols((c) =>
      c.map((col) => ({ ...col, tasks: col.tasks.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)) })),
    );
    start(async () => {
      const r = await toggleTaskDone({ id: t.id, done: !t.done });
      if (r.error) {
        toast.error(r.error);
        setCols(columns);
      }
    });
  }

  function soltar(listId: string, index: number) {
    setOverCol(null);
    if (!dragId) return;
    mover(dragId, listId, index);
    setDragId(null);
  }

  const aberta = cols.flatMap((c) => c.tasks).find((t) => t.id === openId) ?? null;
  const colunaMenu = cols.find((c) => c.id === colMenu) ?? null;

  return (
    <>
      {/* -mx-4 leva a rolagem ate a borda da tela; o px-4 devolve o respiro. */}
      <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-2 sm:-mx-6 sm:px-6">
        <ol className="flex snap-x snap-mandatory items-start gap-3 md:snap-none">
          {cols.map((col) => (
            <li
              key={col.id}
              className={cn(
                "w-[17.5rem] shrink-0 snap-start rounded-[--radius-card] border bg-surface",
                overCol === col.id ? "border-brand" : "border-line",
              )}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverCol(col.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                soltar(col.id, col.tasks.length);
              }}
            >
              <div className="flex items-center justify-between gap-2 py-1 pl-3 pr-1">
                <h2 className="min-w-0 truncate text-[13px] font-semibold text-ink">
                  {col.name}
                  <span className="tabular ml-1.5 font-normal text-ink-muted">{col.tasks.length}</span>
                </h2>
                <button
                  type="button"
                  aria-label={`Opções da coluna ${col.name}`}
                  onClick={() => setColMenu(col.id)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </button>
              </div>

              <ul className="space-y-2 px-2">
                {col.tasks.map((t, i) => (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", t.id);
                      setDragId(t.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverCol(null);
                    }}
                    onDrop={(e) => {
                      // Soltar sobre um cartao poe a tarefa antes dele.
                      e.preventDefault();
                      e.stopPropagation();
                      soltar(col.id, i);
                    }}
                    className={cn(dragId === t.id && "opacity-40")}
                  >
                    <TaskCard
                      task={t}
                      members={members}
                      todayIso={todayIso}
                      onOpen={() => setOpenId(t.id)}
                      onToggle={() => marcar(t)}
                    />
                  </li>
                ))}
              </ul>

              <NewTask listId={col.id} />
            </li>
          ))}
          <li className="w-[17.5rem] shrink-0 snap-start">
            <NewColumn />
          </li>
        </ol>
      </div>

      {aberta ? (
        <TaskDialog
          key={aberta.id}
          task={aberta}
          columns={cols}
          members={members}
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {colunaMenu ? (
        <ColumnDialog
          key={colunaMenu.id}
          column={colunaMenu}
          first={cols[0]?.id === colunaMenu.id}
          last={cols.at(-1)?.id === colunaMenu.id}
          onClose={() => setColMenu(null)}
        />
      ) : null}
    </>
  );
}

function TaskCard({
  task,
  members,
  todayIso,
  onOpen,
  onToggle,
}: {
  task: Task;
  members: Person[];
  todayIso: string;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const quem = whoLabel(task, members);
  const dinheiro = taskMoney(task);
  const temDinheiro = dinheiro.expectedCents !== null || task.linked.length > 0;
  const vencida = isOverdue(task, todayIso);

  return (
    <div className="flex items-start gap-1 rounded-[--radius-control] border border-line bg-surface-2 py-1 pl-1 pr-3 transition-colors hover:border-line-strong">
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Desmarcar “${task.title}”` : `Marcar “${task.title}” como feita`}
        onClick={onToggle}
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded-full border",
            task.done ? "border-positive bg-positive text-white" : "border-line-strong",
          )}
        >
          {task.done ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
        </span>
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-2.5 text-left">
        <span className={cn("block break-words text-sm", task.done ? "text-ink-muted line-through" : "text-ink")}>
          {task.title}
        </span>
        {task.dueDate || quem || temDinheiro ? (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-muted">
            {task.dueDate ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  vencida && "rounded-full bg-danger-soft px-1.5 font-medium text-danger",
                )}
              >
                <CalendarDays className="size-3" aria-hidden />
                <span className="tabular">{dia(task.dueDate)}</span>
                {vencida ? <span className="sr-only">(vencida)</span> : null}
              </span>
            ) : null}
            {quem ? (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" aria-hidden />
                {quem}
              </span>
            ) : null}
            {temDinheiro ? (
              <span className={cn("tabular", dinheiro.over && "font-medium text-danger")}>
                {formatCentsCompact(dinheiro.spentCents)}
                {dinheiro.expectedCents !== null ? ` de ${formatCentsCompact(dinheiro.expectedCents)}` : ""}
              </span>
            ) : null}
          </span>
        ) : null}
        {dinheiro.ratio !== null ? (
          <span className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <span
              className={cn("block h-full rounded-full", dinheiro.over ? "bg-danger" : "bg-brand")}
              style={{ width: `${Math.min(100, Math.round(dinheiro.ratio * 100))}%` }}
            />
          </span>
        ) : null}
      </button>
    </div>
  );
}

function NewTask({ listId }: { listId: string }) {
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [pending, start] = useTransition();

  if (!aberto) {
    return (
      <div className="p-2">
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="flex min-h-11 w-full items-center gap-2 rounded-[--radius-control] px-2 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Plus className="size-4" aria-hidden />
          Adicionar tarefa
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-2 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!titulo.trim()) return;
        start(async () => {
          const r = await createTask({ listId, title: titulo });
          if (r.error) toast.error(r.error);
          // Fica aberto para a proxima: quem cria uma, costuma criar varias.
          else setTitulo("");
        });
      }}
    >
      <Input
        autoFocus
        aria-label="Nova tarefa"
        placeholder="O que precisa ser feito?"
        maxLength={200}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAberto(false);
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !titulo.trim()}>
          {pending ? "Adicionando…" : "Adicionar"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>
    </form>
  );
}

function NewColumn() {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [pending, start] = useTransition();

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex min-h-12 w-full items-center gap-2 rounded-[--radius-card] border border-dashed border-line-strong px-3 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Plus className="size-4" aria-hidden />
        Nova coluna
      </button>
    );
  }

  return (
    <form
      className="space-y-2 rounded-[--radius-card] border border-line bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createList({ name: nome });
          if (r.error) toast.error(r.error);
          else {
            setNome("");
            setAberto(false);
          }
        });
      }}
    >
      <Input
        autoFocus
        aria-label="Nome da coluna"
        placeholder="Nome da coluna"
        maxLength={60}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAberto(false);
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !nome.trim()}>
          {pending ? "Criando…" : "Criar coluna"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>
    </form>
  );
}

function ColumnDialog({
  column,
  first,
  last,
  onClose,
}: {
  column: BoardColumn;
  first: boolean;
  last: boolean;
  onClose: () => void;
}) {
  const [nome, setNome] = useState(column.name);
  const [pending, start] = useTransition();
  const [apagar, setApagar] = useState(false);

  function rodar(acao: () => Promise<{ error?: string }>, fechar = true) {
    start(async () => {
      const r = await acao();
      if (r.error) toast.error(r.error);
      else if (fechar) onClose();
    });
  }

  const n = column.tasks.length;

  return (
    <>
      <Dialog open={!apagar} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          title="Coluna"
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setApagar(true)} disabled={pending}>
                Excluir
              </Button>
              <Button
                className="flex-1"
                disabled={pending || !nome.trim() || nome.trim() === column.name}
                onClick={() => rodar(() => renameList({ id: column.id, name: nome }))}
              >
                {pending ? "Salvando…" : "Salvar nome"}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="coluna-nome" className="block text-[13px] font-medium text-ink-muted">
                Nome
              </label>
              <Input id="coluna-nome" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={pending || first}
                onClick={() => rodar(() => moveList({ id: column.id, direction: -1 }), false)}
              >
                ← Para a esquerda
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                disabled={pending || last}
                onClick={() => rodar(() => moveList({ id: column.id, direction: 1 }), false)}
              >
                Para a direita →
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={apagar}
        onOpenChange={(o) => {
          if (!o) setApagar(false);
        }}
        title="Excluir coluna"
        itemLabel={column.name}
        description={
          n === 0
            ? "A coluna está vazia."
            : `${n === 1 ? "A tarefa dela também será excluída" : `As ${n} tarefas dela também serão excluídas`}. Os lançamentos ligados continuam no extrato.`
        }
        pending={pending}
        onConfirm={() => rodar(() => deleteList({ id: column.id }))}
      />
    </>
  );
}
