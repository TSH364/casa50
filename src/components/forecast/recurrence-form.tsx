"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { createRecurrence, updateRecurrence } from "@/actions/recurrences";
import type { FormState } from "@/actions/shared";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { Card, Category, Recurrence } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

const INTERVALS = [
  { value: "monthly", label: "Todo mês" },
  { value: "weekly", label: "Toda semana" },
  { value: "yearly", label: "Todo ano" },
];

function Footer({ isEdit }: { isEdit: boolean }) {
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
        form="recurrence-form"
        disabled={pending}
        aria-busy={pending}
        className="min-h-11 flex-1 rounded-[--radius-control] bg-brand text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
      >
        {pending ? "Salvando…" : isEdit ? "Salvar" : "Criar recorrência"}
      </button>
    </div>
  );
}

export function RecurrenceFormDialog({
  open,
  onOpenChange,
  recurrence,
  categories,
  cards,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ausente = criação. */
  recurrence?: Recurrence;
  categories: Category[];
  cards: Card[];
  members: MemberSummary[];
}) {
  const isEdit = recurrence !== undefined;
  const action = isEdit
    ? updateRecurrence.bind(null, recurrence.id)
    : createRecurrence;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? "Recorrência atualizada." : "Recorrência criada.");
      onOpenChange(false);
    }
  }, [state.ok, isEdit, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? "Editar recorrência" : "Nova recorrência"}
        description="Isto não cria lançamento: descreve o que deve aparecer, para o app avisar quando não aparecer."
        footer={<Footer isEdit={isEdit} />}
      >
        <form id="recurrence-form" action={formAction} className="space-y-3">
          {state.error ? (
            <p
              role="alert"
              className="rounded-[--radius-control] bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            >
              {state.error}
            </p>
          ) : null}

          <Field
            label="Descrição"
            htmlFor="description"
            error={state.fieldErrors?.description}
          >
            <Input
              id="description"
              name="description"
              required
              maxLength={120}
              autoComplete="off"
              defaultValue={recurrence?.description}
              placeholder="Netflix, aluguel, academia…"
            />
          </Field>

          <Field
            label="Como aparece na fatura"
            htmlFor="merchant"
            hint="Opcional. Ajuda a casar com o lançamento quando o nome vem diferente."
            error={state.fieldErrors?.merchant}
          >
            <Input
              id="merchant"
              name="merchant"
              maxLength={120}
              autoComplete="off"
              defaultValue={recurrence?.merchant ?? ""}
              placeholder="NETFLIX.COM"
            />
          </Field>

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
                defaultValue={recurrence ? String(recurrence.amount) : ""}
                placeholder="0,00"
              />
            </Field>

            <Field
              label="Dia esperado"
              htmlFor="expectedDay"
              hint="Antes dele, nada é cobrado como atraso."
              error={state.fieldErrors?.expectedDay}
            >
              <Input
                id="expectedDay"
                name="expectedDay"
                type="number"
                min={1}
                max={31}
                defaultValue={recurrence?.expectedDay ?? ""}
                placeholder="10"
              />
            </Field>
          </div>

          <Field label="Frequência" htmlFor="interval">
            <Select
              id="interval"
              name="interval"
              defaultValue={recurrence?.interval ?? "monthly"}
              options={INTERVALS}
            />
          </Field>

          <Field label="Categoria" htmlFor="categoryId">
            <Select
              id="categoryId"
              name="categoryId"
              placeholder="Sem categoria"
              defaultValue={recurrence?.categoryId ?? ""}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cartão" htmlFor="cardId">
              <Select
                id="cardId"
                name="cardId"
                placeholder="Nenhum"
                defaultValue={recurrence?.cardId ?? ""}
                options={cards
                  .filter((c) => c.isActive)
                  .map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>

            <Field label="De quem é" htmlFor="ownerId">
              <Select
                id="ownerId"
                name="ownerId"
                placeholder="Da casa"
                defaultValue={recurrence?.ownerId ?? ""}
                options={members.map((m) => ({
                  value: m.userId,
                  label: m.fullName,
                }))}
              />
            </Field>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
