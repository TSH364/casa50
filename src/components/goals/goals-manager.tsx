"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  PiggyBank,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { deleteGoal, deleteGoalDeposit, setGoalStatus } from "@/actions/goals";
import { DepositDialog, GoalFormDialog } from "./goal-dialogs";
import { Button } from "@/components/ui/button";
import { Card as Panel, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/states";
import { goalProgress } from "@/domain/forecast";
import { monthLabel } from "@/domain/month";
import { formatBRL, formatCents, toCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Goal } from "@/domain/types";
import type { GoalDeposit } from "@/data/queries";
import type { MemberSummary } from "@/lib/houses";

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function GoalsManager({
  goals,
  deposits,
  members,
}: {
  goals: Goal[];
  deposits: GoalDeposit[];
  members: MemberSummary[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | undefined>();
  const [depositing, setDepositing] = useState<Goal | undefined>();
  const [deleting, setDeleting] = useState<Goal | undefined>();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const memberName = (id: string | null) =>
    members.find((m) => m.userId === id)?.fullName ?? null;

  function run(action: () => Promise<{ error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else toast.success(success);
    });
  }

  const active = goals.filter((g) => g.status === "active");
  const done = goals.filter((g) => g.status !== "active");

  function renderGoal(goal: Goal) {
    const progress = goalProgress(
      toCents(goal.currentAmount),
      toCents(goal.targetAmount),
      {
        targetDate: goal.targetDate,
        monthlyContributionCents: goal.monthlyContribution
          ? toCents(goal.monthlyContribution)
          : null,
      },
    );
    const mine = deposits.filter((d) => d.goalId === goal.id);
    const isOpen = expanded === goal.id;

    return (
      <li
        key={goal.id}
        className="rounded-[--radius-control] bg-surface-2 px-3 py-3"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{goal.name}</p>
            <p className="truncate text-[12px] text-ink-faint">
              {memberName(goal.ownerId) ?? "Da casa"}
              {goal.targetDate
                ? ` · prazo ${dateFormat.format(new Date(`${goal.targetDate}T12:00:00`))}`
                : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Registrar aporte em ${goal.name}`}
              onClick={() => setDepositing(goal)}
            >
              <PiggyBank aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Editar ${goal.name}`}
              onClick={() => {
                setEditing(goal);
                setFormOpen(true);
              }}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Excluir ${goal.name}`}
              onClick={() => setDeleting(goal)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="tabular text-base font-semibold text-ink">
            {formatBRL(goal.currentAmount)}
          </span>
          <span className="tabular text-[13px] text-ink-faint">
            de {formatBRL(goal.targetAmount)}
          </span>
        </div>

        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3"
          role="img"
          aria-label={`${Math.round(progress.ratio * 100)}% da meta alcançado`}
        >
          <span
            className={cn(
              "block h-full rounded-full transition-all",
              progress.isComplete ? "bg-positive" : "bg-brand",
            )}
            style={{ width: `${Math.min(100, progress.ratio * 100)}%` }}
          />
        </div>

        <p className="mt-1.5 text-[12px]">
          {progress.isComplete ? (
            <span className="text-positive">Meta alcançada.</span>
          ) : (
            <span className="text-ink-faint">
              Faltam {formatCents(progress.remainingCents)}
              {progress.neededPerMonthCents !== null && progress.monthsLeft
                ? ` · ${formatCents(progress.neededPerMonthCents)}/mês para chegar no prazo`
                : ""}
              {progress.projectedMonth && progress.monthsLeft === null
                ? ` · no ritmo atual, fecha em ${monthLabel(progress.projectedMonth)}`
                : ""}
            </span>
          )}
        </p>

        {progress.onTrack === false ? (
          <p className="mt-1 text-[12px] text-attention">
            O aporte de {formatBRL(goal.monthlyContribution ?? 0)}/mês não
            alcança o prazo
            {progress.projectedMonth
              ? ` — nesse ritmo, fecha em ${monthLabel(progress.projectedMonth)}`
              : ""}
            .
          </p>
        ) : null}
        {progress.onTrack === true ? (
          <p className="mt-1 text-[12px] text-positive">
            No ritmo do aporte declarado, o prazo é alcançado.
          </p>
        ) : null}

        {goal.note ? (
          <p className="mt-1.5 text-[12px] text-ink-muted">{goal.note}</p>
        ) : null}

        {mine.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : goal.id)}
              aria-expanded={isOpen}
              className="mt-2 flex min-h-9 items-center gap-1 text-[12px] text-brand"
            >
              <ChevronDown
                className={cn("size-3 transition-transform", isOpen && "rotate-180")}
                aria-hidden
              />
              {mine.length} aporte(s)
            </button>

            {isOpen ? (
              <ul className="mt-1.5 space-y-1 border-l border-line pl-3">
                {mine.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 py-1">
                    <span className="w-20 shrink-0 text-[12px] text-ink-faint">
                      {dateFormat.format(new Date(`${d.date}T12:00:00`))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
                      {d.note ?? memberName(d.memberId) ?? "—"}
                    </span>
                    <span
                      className={cn(
                        "tabular shrink-0 text-[13px]",
                        d.amount < 0 ? "text-danger" : "text-ink",
                      )}
                    >
                      {d.amount < 0 ? "−" : "+"}
                      {formatBRL(Math.abs(d.amount))}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir aporte"
                      disabled={pending}
                      onClick={() =>
                        run(() => deleteGoalDeposit(d.id), "Aporte excluído.")
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {progress.isComplete && goal.status === "active" ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            disabled={pending}
            onClick={() =>
              run(() => setGoalStatus(goal.id, "completed"), "Meta concluída.")
            }
          >
            <Check aria-hidden /> Marcar como concluída
          </Button>
        ) : null}
      </li>
    );
  }

  return (
    <>
      <Panel>
        <CardHeader
          title="Metas"
          description="Quanto já foi guardado, quanto falta e se o ritmo alcança o prazo."
          action={
            <Button
              size="sm"
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden /> Nova
            </Button>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            title="Nenhuma meta ativa"
            description="Uma viagem, a reserva de emergência, a entrada de um imóvel — o app acompanha o quanto falta."
            action={
              <Button
                size="sm"
                onClick={() => {
                  setEditing(undefined);
                  setFormOpen(true);
                }}
              >
                <Plus aria-hidden /> Criar meta
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">{active.map(renderGoal)}</ul>
        )}
      </Panel>

      {done.length > 0 ? (
        <Panel>
          <CardHeader title="Concluídas e pausadas" />
          <ul className="space-y-2 opacity-70">{done.map(renderGoal)}</ul>
        </Panel>
      ) : null}

      <GoalFormDialog
        key={editing?.id ?? "nova"}
        open={formOpen}
        onOpenChange={setFormOpen}
        goal={editing}
        members={members}
      />

      <DepositDialog
        key={depositing?.id ?? "sem"}
        open={depositing !== undefined}
        onOpenChange={(open) => {
          if (!open) setDepositing(undefined);
        }}
        goal={depositing}
        members={members}
      />

      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Excluir meta"
        itemLabel={deleting?.name ?? ""}
        description="Os aportes registrados nela também somem. Isso não mexe em lançamento nenhum."
        pending={pending}
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const result = await deleteGoal(deleting.id);
            if (result.error) toast.error(result.error);
            else toast.success("Meta excluída.");
            setDeleting(undefined);
          });
        }}
      />
    </>
  );
}
