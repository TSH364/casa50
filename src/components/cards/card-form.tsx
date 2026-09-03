"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { createCard, updateCard } from "@/actions/cards";
import type { FormState } from "@/actions/shared";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { Card } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

const BRANDS = [
  { value: "Visa", label: "Visa" },
  { value: "Mastercard", label: "Mastercard" },
  { value: "Elo", label: "Elo" },
  { value: "American Express", label: "American Express" },
  { value: "Hipercard", label: "Hipercard" },
  { value: "Outra", label: "Outra" },
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
        form="card-form"
        disabled={pending}
        aria-busy={pending}
        className="min-h-11 flex-1 rounded-[--radius-control] bg-brand text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
      >
        {pending ? "Salvando…" : isEdit ? "Salvar alterações" : "Adicionar cartão"}
      </button>
    </div>
  );
}

export function CardFormDialog({
  open,
  onOpenChange,
  card,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ausente = criação. */
  card?: Card;
  members: MemberSummary[];
}) {
  const isEdit = card !== undefined;
  const action = isEdit ? updateCard.bind(null, card.id) : createCard;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  // A action não redireciona; o diálogo só fecha quando ela confirma sucesso,
  // para nunca sinalizar "salvo" sem ter gravado no banco (secao 9).
  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? "Cartão atualizado." : "Cartão adicionado.");
      onOpenChange(false);
    }
  }, [state.ok, isEdit, onOpenChange]);

  const err = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? "Editar cartão" : "Novo cartão"}
        description={
          isEdit ? undefined : "O dono do cartão é quem paga a fatura."
        }
        footer={<Footer isEdit={isEdit} />}
      >
        <form id="card-form" action={formAction} className="space-y-4" noValidate>
          <Field label="Nome" htmlFor="name" error={err.name}>
            <Input
              id="name"
              name="name"
              required
              maxLength={60}
              defaultValue={card?.name ?? ""}
              placeholder="Nubank Vinicius"
              aria-invalid={err.name ? true : undefined}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Instituição" htmlFor="institution" error={err.institution}>
              <Input
                id="institution"
                name="institution"
                defaultValue={card?.institution ?? ""}
                placeholder="Nubank"
              />
            </Field>
            <Field label="Bandeira" htmlFor="brand" error={err.brand}>
              <Select
                id="brand"
                name="brand"
                options={BRANDS}
                placeholder="—"
                defaultValue={card?.brand ?? ""}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Últimos 4 dígitos"
              htmlFor="lastFour"
              error={err.lastFour}
              hint="Ajuda a casar a fatura com o cartão."
            >
              <Input
                id="lastFour"
                name="lastFour"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                defaultValue={card?.lastFour ?? ""}
                placeholder="4821"
                aria-invalid={err.lastFour ? true : undefined}
              />
            </Field>
            <Field label="Dono" htmlFor="ownerId" error={err.ownerId}>
              <Select
                id="ownerId"
                name="ownerId"
                placeholder="—"
                defaultValue={card?.ownerId ?? ""}
                options={members.map((m) => ({ value: m.userId, label: m.fullName }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Dia de fechamento" htmlFor="closingDay" error={err.closingDay}>
              <Input
                id="closingDay"
                name="closingDay"
                inputMode="numeric"
                defaultValue={card?.closingDay ?? ""}
                placeholder="3"
                aria-invalid={err.closingDay ? true : undefined}
              />
            </Field>
            <Field label="Dia de vencimento" htmlFor="dueDay" error={err.dueDay}>
              <Input
                id="dueDay"
                name="dueDay"
                inputMode="numeric"
                defaultValue={card?.dueDay ?? ""}
                placeholder="10"
                aria-invalid={err.dueDay ? true : undefined}
              />
            </Field>
          </div>

          <Field label="Limite" htmlFor="creditLimit" error={err.creditLimit}>
            <Input
              id="creditLimit"
              name="creditLimit"
              inputMode="decimal"
              defaultValue={card?.creditLimit ?? ""}
              placeholder="12.000,00"
              aria-invalid={err.creditLimit ? true : undefined}
            />
          </Field>

          {state.error ? (
            <p
              role="alert"
              className="rounded-[--radius-control] bg-danger-soft px-3 py-2 text-[13px] text-danger"
            >
              {state.error}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
