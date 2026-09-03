"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { createCategory, updateCategory } from "@/actions/categories";
import type { FormState } from "@/actions/shared";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Category } from "@/domain/types";

/**
 * Paleta sugerida. É atalho, não restrição: o campo de cor aceita qualquer
 * valor, e a secao 5 diz que a categoria é do casal, não do sistema.
 */
const SWATCHES = [
  "#E86A5E", "#E8975E", "#E8C65E", "#8FBF6A", "#5EA88C",
  "#5E9FE8", "#7B76E8", "#B06AE8", "#E86AB0", "#8B8B94",
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
        form="category-form"
        disabled={pending}
        aria-busy={pending}
        className="min-h-11 flex-1 rounded-[--radius-control] bg-brand text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
      >
        {pending ? "Salvando…" : isEdit ? "Salvar" : "Criar categoria"}
      </button>
    </div>
  );
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
  parents,
  defaultParentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ausente = criação. */
  category?: Category;
  /** Categorias de primeiro nível, para escolher onde encaixar. */
  parents: Category[];
  defaultParentId?: string;
}) {
  const isEdit = category !== undefined;
  const action = isEdit ? updateCategory.bind(null, category.id) : createCategory;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [color, setColor] = useState(category?.color ?? SWATCHES[0]!);

  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? "Categoria atualizada." : "Categoria criada.");
      onOpenChange(false);
    }
  }, [state.ok, isEdit, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? "Editar categoria" : "Nova categoria"}
        description={
          isEdit
            ? undefined
            : "Categorias existem para o casal se entender, não para o sistema."
        }
        footer={<Footer isEdit={isEdit} />}
      >
        <form id="category-form" action={formAction} className="space-y-3">
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
              maxLength={60}
              autoComplete="off"
              defaultValue={category?.name}
              placeholder="Mercado, Lazer, Casa…"
            />
          </Field>

          {!isEdit ? (
            <Field
              label="Dentro de"
              htmlFor="parentId"
              hint="Deixe em branco para criar uma categoria principal."
            >
              <Select
                id="parentId"
                name="parentId"
                placeholder="Categoria principal"
                defaultValue={defaultParentId ?? ""}
                options={parents.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
          ) : null}

          <Field label="Cor" htmlFor="color" error={state.fieldErrors?.color}>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Usar a cor ${swatch}`}
                    aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
                    onClick={() => setColor(swatch)}
                    className={cn(
                      "size-8 rounded-full border-2 transition-transform",
                      color.toLowerCase() === swatch.toLowerCase()
                        ? "border-ink scale-110"
                        : "border-transparent",
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
              <input
                id="color"
                name="color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-11 w-full cursor-pointer rounded-[--radius-control] border border-line-strong bg-surface-2 p-1"
              />
            </div>
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
