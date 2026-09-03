"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Lightbulb } from "lucide-react";
import { copyBudgetsFromPreviousMonth, setBudget } from "@/actions/budgets";
import { Button } from "@/components/ui/button";
import { Card as Panel, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { formatCents, parseAmountCents } from "@/lib/money";
import { monthLabel } from "@/domain/month";
import { cn } from "@/lib/utils";
import type { BudgetProgress } from "@/domain/finance";
import type { Category, MonthKey } from "@/domain/types";

export interface BudgetRow {
  category: Category;
  limitCents: number;
  spentCents: number;
  progress: BudgetProgress | null;
  /** Média dos meses anteriores, quando houver base para sugerir. */
  suggestionCents: number | null;
}

function ProgressBar({ progress }: { progress: BudgetProgress }) {
  const width = Math.min(100, progress.ratio * 100);
  return (
    <div
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
      role="img"
      aria-label={`${Math.round(progress.ratio * 100)}% do limite usado`}
    >
      <span
        className={cn(
          "block h-full rounded-full transition-all",
          progress.isOver
            ? "bg-danger"
            : progress.isWarning
              ? "bg-attention"
              : "bg-positive",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function BudgetsManager({
  rows,
  month,
}: {
  rows: BudgetRow[];
  month: MonthKey;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  function save(category: Category) {
    const cents = draft.trim() === "" ? 0 : parseAmountCents(draft);
    if (cents === null) {
      toast.error("Valor inválido.");
      return;
    }
    startTransition(async () => {
      const result = await setBudget({
        categoryId: category.id,
        month,
        limitCents: cents,
      });
      if (result.error) toast.error(result.error);
      else
        toast.success(
          cents === 0
            ? `Orçamento de ${category.name} removido.`
            : `Orçamento de ${category.name} definido.`,
        );
      setEditing(null);
    });
  }

  function copyPrevious() {
    startTransition(async () => {
      const result = await copyBudgetsFromPreviousMonth(month);
      if (result.error) toast.error(result.error);
      else if (result.copied === 0)
        toast.info("Nada novo para copiar — este mês já está definido.");
      else toast.success(`${result.copied} orçamento(s) copiados.`);
    });
  }

  const withBudget = rows.filter((r) => r.limitCents > 0);
  const without = rows.filter((r) => r.limitCents === 0);

  const totalLimit = withBudget.reduce((s, r) => s + r.limitCents, 0);
  const totalSpent = withBudget.reduce((s, r) => s + r.spentCents, 0);

  function renderRow(row: BudgetRow) {
    const isEditing = editing === row.category.id;
    return (
      <li
        key={row.category.id}
        className="rounded-[--radius-control] bg-surface-2 px-3 py-3"
      >
        <div className="flex items-center gap-3">
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: row.category.color }}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">
            {row.category.name}
          </span>

          {isEditing ? (
            <div className="flex shrink-0 items-center gap-2">
              <Input
                autoFocus
                inputMode="decimal"
                aria-label={`Limite de ${row.category.name}`}
                className="w-28"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save(row.category);
                  if (e.key === "Escape") setEditing(null);
                }}
                placeholder="0,00"
              />
              <Button
                size="sm"
                disabled={pending}
                onClick={() => save(row.category)}
              >
                Salvar
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(
                  row.limitCents > 0 ? String(row.limitCents / 100).replace(".", ",") : "",
                );
                setEditing(row.category.id);
              }}
              className="tabular shrink-0 rounded-[--radius-control] px-2 py-1 text-sm text-ink transition-colors hover:bg-surface-3"
            >
              {row.limitCents > 0 ? (
                <>
                  {formatCents(row.spentCents)}
                  <span className="text-ink-faint">
                    {" / "}
                    {formatCents(row.limitCents)}
                  </span>
                </>
              ) : (
                <span className="text-ink-faint">definir limite</span>
              )}
            </button>
          )}
        </div>

        {row.progress ? (
          <>
            <ProgressBar progress={row.progress} />
            <p className="mt-1.5 text-[12px]">
              {row.progress.isOver ? (
                <span className="text-danger">
                  Passou {formatCents(row.progress.overCents)} do limite.
                </span>
              ) : row.progress.isWarning ? (
                <span className="text-attention">
                  Restam {formatCents(row.progress.remainingCents)} —{" "}
                  {Math.round(row.progress.ratio * 100)}% usado.
                </span>
              ) : (
                <span className="text-ink-faint">
                  Restam {formatCents(row.progress.remainingCents)}
                  {row.progress.daysLeft > 0
                    ? ` · ${formatCents(row.progress.dailyPaceCents)} por dia até o fim do mês`
                    : ""}
                </span>
              )}
            </p>
          </>
        ) : row.suggestionCents !== null ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
            <Lightbulb className="size-3 shrink-0" aria-hidden />
            Média dos últimos meses: {formatCents(row.suggestionCents)}
            <button
              type="button"
              className="text-brand underline underline-offset-2"
              onClick={() => {
                setDraft(String(row.suggestionCents! / 100).replace(".", ","));
                setEditing(row.category.id);
              }}
            >
              usar
            </button>
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] text-ink-faint">
            Gasto no mês: {formatCents(row.spentCents)}
          </p>
        )}
      </li>
    );
  }

  return (
    <>
      <Panel>
        <CardHeader
          title={`Orçamentos de ${monthLabel(month)}`}
          description="O limite vale só para este mês — ajustar dezembro não mexe em novembro."
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={copyPrevious}
            >
              <Copy aria-hidden /> Copiar anterior
            </Button>
          }
        />

        {withBudget.length > 0 ? (
          <>
            <div className="mb-3 flex items-baseline justify-between rounded-[--radius-control] bg-surface-3 px-3 py-2.5">
              <span className="text-[13px] text-ink-muted">
                Total orçado neste mês
              </span>
              <span className="tabular text-sm font-semibold text-ink">
                {formatCents(totalSpent)}
                <span className="font-normal text-ink-faint">
                  {" / "}
                  {formatCents(totalLimit)}
                </span>
              </span>
            </div>
            <ul className="space-y-2">{withBudget.map(renderRow)}</ul>
          </>
        ) : (
          <p className="py-4 text-center text-[13px] text-ink-faint">
            Nenhum limite definido para este mês. Toque numa categoria abaixo
            para começar.
          </p>
        )}
      </Panel>

      {without.length > 0 ? (
        <Panel>
          <CardHeader
            title="Sem orçamento"
            description="Categorias que ainda não têm limite neste mês."
          />
          <ul className="space-y-2">{without.map(renderRow)}</ul>
        </Panel>
      ) : null}
    </>
  );
}
