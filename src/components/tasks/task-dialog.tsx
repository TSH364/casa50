"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Link2, Search, X } from "lucide-react";
import {
  deleteTask,
  linkTransaction,
  moveTask,
  searchTransactionsForTask,
  unlinkTransaction,
  updateTask,
  type TransactionOption,
} from "@/actions/tasks";
import { taskMoney, type BoardColumn, type Task } from "@/domain/tasks";
import { DOS_DOIS } from "@/domain/schemas";
import { formatCents, fromCents, parseAmountCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import type { Person } from "./task-board";

/**
 * Uma tarefa aberta (secao 17): texto, quem faz, prazo, previsto, e os
 * lancamentos ligados.
 *
 * Os campos gravam juntos, em "Salvar". Ligar e desligar lancamento grava na
 * hora - e uma acao sobre outra tabela, e esperar o "Salvar" para ela faria o
 * total na tela mentir ate la.
 */

const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

function reais(cents: number | null): string {
  if (cents === null) return "";
  return fromCents(cents).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function TaskDialog({
  task,
  columns,
  members,
  onClose,
}: {
  task: Task;
  columns: BoardColumn[];
  members: Person[];
  onClose: () => void;
}) {
  const colunaAtual = columns.find((c) => c.id === task.listId);
  const indiceAtual = colunaAtual?.tasks.findIndex((t) => t.id === task.id) ?? 0;

  const [titulo, setTitulo] = useState(task.title);
  const [notas, setNotas] = useState(task.notes ?? "");
  const [quem, setQuem] = useState(task.isJoint ? DOS_DOIS : (task.memberId ?? ""));
  const [prazo, setPrazo] = useState(task.dueDate ?? "");
  const [previsto, setPrevisto] = useState(reais(task.expectedCents));
  const [feita, setFeita] = useState(task.done);
  const [coluna, setColuna] = useState(task.listId);
  const [posicao, setPosicao] = useState(String(Math.max(0, indiceAtual)));
  const [erroPrevisto, setErroPrevisto] = useState<string | undefined>();
  const [apagar, setApagar] = useState(false);
  const [pending, start] = useTransition();

  const destino = columns.find((c) => c.id === coluna);
  // Na mesma coluna, as posicoes sao as que existem; noutra, uma a mais (o fim).
  const vagas = destino ? destino.tasks.filter((t) => t.id !== task.id).length + 1 : 1;
  const posicoes = Array.from({ length: vagas }, (_, i) => ({
    value: String(i),
    label: i === 0 ? "1ª (topo)" : i === vagas - 1 ? `${i + 1}ª (fim)` : `${i + 1}ª`,
  }));

  function trocarColuna(id: string) {
    setColuna(id);
    const alvo = columns.find((c) => c.id === id);
    // Noutra coluna, o comum e ir para o fim; de volta a de origem, o lugar de antes.
    setPosicao(String(id === task.listId ? Math.max(0, indiceAtual) : (alvo?.tasks.length ?? 0)));
  }

  function salvar() {
    const texto = previsto.trim();
    const cents = texto === "" ? null : parseAmountCents(texto);
    if (texto !== "" && (cents === null || cents < 0)) {
      setErroPrevisto("Valor inválido. Ex.: 250,00");
      return;
    }
    setErroPrevisto(undefined);
    start(async () => {
      const r = await updateTask({
        id: task.id,
        title: titulo,
        notes: notas.trim() || null,
        who: quem,
        dueDate: prazo || null,
        expectedCents: cents,
        done: feita,
      });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      const index = Number(posicao);
      if (coluna !== task.listId || index !== indiceAtual) {
        const m = await moveTask({ id: task.id, listId: coluna, index });
        if (m.error) {
          toast.error(m.error);
          return;
        }
      }
      onClose();
    });
  }

  const pessoas = [
    { value: "", label: "Ninguém" },
    ...members.map((m) => ({ value: m.id, label: m.name })),
    ...(members.length >= 2 ? [{ value: DOS_DOIS, label: members.length === 2 ? "Os dois" : "Todos" }] : []),
  ];

  return (
    <>
      <Dialog open={!apagar} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          title="Tarefa"
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setApagar(true)} disabled={pending}>
                Excluir
              </Button>
              <Button className="flex-1" onClick={salvar} disabled={pending || !titulo.trim()}>
                {pending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="O que fazer" htmlFor="tarefa-titulo">
              <Input id="tarefa-titulo" maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </Field>

            <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={feita}
                onChange={(e) => setFeita(e.target.checked)}
                className="size-5 accent-[var(--color-positive)]"
              />
              Feita
            </label>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Coluna" htmlFor="tarefa-coluna">
                <Select
                  id="tarefa-coluna"
                  value={coluna}
                  onChange={(e) => trocarColuna(e.target.value)}
                  options={columns.map((c) => ({ value: c.id, label: c.name }))}
                />
              </Field>
              <Field label="Posição" htmlFor="tarefa-posicao">
                <Select
                  id="tarefa-posicao"
                  value={posicao}
                  onChange={(e) => setPosicao(e.target.value)}
                  options={posicoes}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Quem faz" htmlFor="tarefa-quem">
                <Select id="tarefa-quem" value={quem} onChange={(e) => setQuem(e.target.value)} options={pessoas} />
              </Field>
              <Field label="Prazo" htmlFor="tarefa-prazo">
                <Input id="tarefa-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
              </Field>
            </div>

            <Field label="Notas" htmlFor="tarefa-notas">
              <Textarea id="tarefa-notas" maxLength={4000} value={notas} onChange={(e) => setNotas(e.target.value)} />
            </Field>

            <Field
              label="Valor previsto (R$)"
              htmlFor="tarefa-previsto"
              hint="Opcional. O gasto real vem dos lançamentos ligados abaixo."
              error={erroPrevisto}
            >
              <Input
                id="tarefa-previsto"
                inputMode="decimal"
                placeholder="0,00"
                value={previsto}
                onChange={(e) => setPrevisto(e.target.value)}
              />
            </Field>

            <Gastos task={task} />
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={apagar}
        onOpenChange={(o) => {
          if (!o) setApagar(false);
        }}
        title="Excluir tarefa"
        itemLabel={task.title}
        description={
          task.linked.length > 0
            ? "Os lançamentos ligados continuam no extrato — só o elo com a tarefa some."
            : undefined
        }
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const r = await deleteTask({ id: task.id });
            if (r.error) toast.error(r.error);
            else onClose();
          })
        }
      />
    </>
  );
}

/** Os lancamentos da tarefa: o que ja esta ligado, e a busca para ligar mais. */
function Gastos({ task }: { task: Task }) {
  const dinheiro = taskMoney(task);
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<TransactionOption[] | null>(null);
  const [pending, start] = useTransition();
  const ligados = new Set(task.linked.map((l) => l.id));

  function procurar(q: string) {
    start(async () => {
      const r = await searchTransactionsForTask({ query: q });
      setOpcoes(r.options);
    });
  }

  function ligar(id: string) {
    start(async () => {
      const r = await linkTransaction({ taskId: task.id, transactionId: id });
      if (r.error) toast.error(r.error);
    });
  }

  function desligar(id: string) {
    start(async () => {
      const r = await unlinkTransaction({ taskId: task.id, transactionId: id });
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <section aria-labelledby="tarefa-gastos" className="space-y-2 border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="tarefa-gastos" className="text-[13px] font-medium text-ink-muted">
          Gastos ligados
        </h3>
        <p className={cn("tabular text-[13px]", dinheiro.over ? "font-medium text-danger" : "text-ink")}>
          {formatCents(dinheiro.spentCents)}
          {dinheiro.expectedCents !== null ? (
            <span className={dinheiro.over ? undefined : "text-ink-faint"}>
              {" "}
              de {formatCents(dinheiro.expectedCents)}
              {dinheiro.over ? " — passou do previsto" : ""}
            </span>
          ) : null}
        </p>
      </div>

      {task.linked.length === 0 ? (
        <p className="text-[13px] text-ink-faint">Nenhum lançamento ligado.</p>
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-control] border border-line">
          {task.linked.map((l) => (
            <li key={l.id} className="flex items-center gap-2 pl-3">
              <span className="tabular w-16 shrink-0 text-[12px] text-ink-faint">{dia(l.date)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{l.label}</span>
              <span className="tabular shrink-0 text-sm text-ink">{formatCents(l.cents)}</span>
              <button
                type="button"
                aria-label={`Desligar ${l.label}`}
                disabled={pending}
                onClick={() => desligar(l.id)}
                className="flex size-11 shrink-0 items-center justify-center text-ink-faint transition-colors hover:text-danger"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!buscando ? (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            setBuscando(true);
            procurar("");
          }}
        >
          <Link2 aria-hidden />
          Ligar lançamento
        </Button>
      ) : (
        <div className="space-y-2">
          <form
            role="search"
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              procurar(busca);
            }}
          >
            <Input
              aria-label="Buscar lançamento"
              placeholder="Loja ou descrição"
              maxLength={80}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <Button type="submit" variant="secondary" size="icon" aria-label="Buscar" disabled={pending}>
              <Search aria-hidden />
            </Button>
          </form>
          <p className="text-[12px] text-ink-faint">Despesas dos últimos 6 meses, mais recentes primeiro.</p>
          {opcoes === null ? (
            <p className="text-[13px] text-ink-faint" aria-live="polite">
              Buscando…
            </p>
          ) : opcoes.length === 0 ? (
            <p className="text-[13px] text-ink-faint" aria-live="polite">
              Nada encontrado.
            </p>
          ) : (
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-[--radius-control] border border-line">
              {opcoes.map((o) => {
                const ja = ligados.has(o.id);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={ja || pending}
                      onClick={() => ligar(o.id)}
                      className="flex min-h-11 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
                    >
                      <span className="tabular w-16 shrink-0 text-[12px] text-ink-faint">{dia(o.date)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{o.label}</span>
                      <span className="tabular shrink-0 text-sm text-ink">
                        {ja ? "ligado" : formatCents(o.cents)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
