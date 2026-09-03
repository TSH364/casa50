"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { addGoalDeposit, createGoal, updateGoal } from "@/actions/goals";
import type { FormState } from "@/actions/shared";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { Goal } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

function Footer({ form, label }: { form: string; label: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex gap-2">
      <DialogClose
        type="button"
        disabled={pending}
        className="min-h-11 flex-1 rounded-[--radius-control] border border-line-strong text-sm text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        Cancelar
      </DialogClose>
      <button
        type="submit"
        form={form}
        disabled={pending}
        aria-busy={pending}
        className="min-h-11 flex-1 rounded-[--radius-control] bg-brand text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
      >
        {pending ? "Salvando…" : label}
      </button>
    </div>
  );
}

export function GoalFormDialog({
  open,
  onOpenChange,
  goal,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: Goal;
  members: MemberSummary[];
}) {
  const isEdit = goal !== undefined;
  const action = isEdit ? updateGoal.bind(null, goal.id) : createGoal;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? "Meta atualizada." : "Meta criada.");
      onOpenChange(false);
    }
  }, [state.ok, isEdit, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? "Editar meta" : "Nova meta"}
        description="O acumulado vem dos aportes registrados — não é um número digitado."
        footer={
          <Footer form="goal-form" label={isEdit ? "Salvar" : "Criar meta"} />
        }
      >
        <form id="goal-form" action={formAction} className="space-y-3">
          {state.error ? (
            <p
              role="alert"
              className="rounded-[--radius-control] bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            >
              {state.error}
            </p>
          ) : null}

          <Field label="Nome" htmlFor="name" error={state.fieldErrors?.name}>
            <Input
              id="name"
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              defaultValue={goal?.name}
              placeholder="Viagem, reserva de emergência, entrada do apê…"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Valor da meta"
              htmlFor="targetAmount"
              error={state.fieldErrors?.targetAmount}
            >
              <Input
                id="targetAmount"
                name="targetAmount"
                required
                inputMode="decimal"
                autoComplete="off"
                defaultValue={goal ? String(goal.targetAmount) : ""}
                placeholder="0,00"
              />
            </Field>

            <Field
              label="Prazo"
              htmlFor="targetDate"
              hint="Opcional."
              error={state.fieldErrors?.targetDate}
            >
              <Input
                id="targetDate"
                name="targetDate"
                type="date"
                defaultValue={goal?.targetDate ?? ""}
              />
            </Field>
          </div>

          <Field
            label="Aporte mensal pretendido"
            htmlFor="monthlyContribution"
            hint="Opcional. Serve para o app dizer se o ritmo alcança o prazo."
            error={state.fieldErrors?.monthlyContribution}
          >
            <Input
              id="monthlyContribution"
              name="monthlyContribution"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={
                goal?.monthlyContribution ? String(goal.monthlyContribution) : ""
              }
              placeholder="0,00"
            />
          </Field>

          <Field label="De quem é" htmlFor="ownerId">
            <Select
              id="ownerId"
              name="ownerId"
              placeholder="Da casa"
              defaultValue={goal?.ownerId ?? ""}
              options={members.map((m) => ({
                value: m.userId,
                label: m.fullName,
              }))}
            />
          </Field>

          <Field label="Observação" htmlFor="note">
            <Textarea
              id="note"
              name="note"
              rows={2}
              maxLength={500}
              defaultValue={goal?.note ?? ""}
              placeholder="Para lembrar por que essa meta existe."
            />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DepositDialog({
  open,
  onOpenChange,
  goal,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: Goal | undefined;
  members: MemberSummary[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    addGoalDeposit,
    {},
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Aporte registrado.");
      onOpenChange(false);
    }
  }, [state.ok, onOpenChange]);

  if (!goal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Registrar aporte"
        description={`Em ${goal.name}. Valor negativo registra uma retirada.`}
        footer={<Footer form="deposit-form" label="Registrar" />}
      >
        <form id="deposit-form" action={formAction} className="space-y-3">
          <input type="hidden" name="goalId" value={goal.id} />

          {state.error ? (
            <p
              role="alert"
              className="rounded-[--radius-control] bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            >
              {state.error}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Valor"
              htmlFor="amount"
              error={state.fieldErrors?.amount}
            >
              <Input
                id="amount"
                name="amount"
                required
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
              />
            </Field>

            <Field label="Data" htmlFor="date" error={state.fieldErrors?.date}>
              <Input
                id="date"
                name="date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </Field>
          </div>

          <Field label="Quem guardou" htmlFor="memberId">
            <Select
              id="memberId"
              name="memberId"
              placeholder="Da casa"
              options={members.map((m) => ({
                value: m.userId,
                label: m.fullName,
              }))}
            />
          </Field>

          <Field label="Observação" htmlFor="deposit-note">
            <Input
              id="deposit-note"
              name="note"
              maxLength={300}
              autoComplete="off"
              placeholder="13º, venda de algo, sobra do mês…"
            />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
