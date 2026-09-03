"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setTransactionCategory } from "@/actions/transactions";
import { cn } from "@/lib/utils";
import type { Category } from "@/domain/types";

/**
 * Seletor de categoria na própria linha do lançamento (secao 9).
 *
 * É um `<select>` nativo de propósito: no celular ele abre a roda do sistema,
 * que é o seletor mais rápido que existe naquele aparelho, e no teclado ele já
 * funciona com setas e busca por letra. Um menu desenhado à mão seria mais
 * bonito e pior de usar.
 *
 * O rótulo fica invisível mas presente: numa lista de dezenas de linhas, um
 * leitor de tela precisa saber a qual lançamento este seletor pertence.
 */
export function CategoryPicker({
  transactionId,
  description,
  categories,
  categoryId,
  subcategoryId,
}: {
  transactionId: string;
  description: string;
  categories: Category[];
  categoryId: string | null;
  subcategoryId: string | null;
}) {
  // A subcategoria é o que o usuário escolheu de mais específico; é ela que
  // deve aparecer selecionada quando existe.
  const [value, setValue] = useState(subcategoryId ?? categoryId ?? "");
  const [pending, startTransition] = useTransition();

  const parents = categories.filter((c) => c.parentId === null);

  function change(next: string) {
    const previous = value;
    // Troca na hora: esperar o servidor para pintar a mudança faz a lista
    // parecer travada quando se categoriza uma linha atrás da outra.
    setValue(next);
    startTransition(async () => {
      const result = await setTransactionCategory(transactionId, next || null);
      if (result.error) {
        setValue(previous);
        toast.error(result.error);
      }
    });
  }

  const chosen = categories.find((c) => c.id === value);

  return (
    <span className="relative inline-flex max-w-[60%] shrink-0 items-center">
      <span
        className="mr-1 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: chosen?.color ?? "transparent" }}
        aria-hidden
      />
      <select
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        aria-label={`Categoria de ${description}`}
        className={cn(
          // Sem cara de campo de formulário: é um rótulo que por acaso é
          // clicável, para não poluir uma lista longa.
          "min-w-0 max-w-full cursor-pointer appearance-none truncate rounded-[--radius-control]",
          "border border-transparent bg-transparent py-0.5 pl-0 pr-3 text-[12px]",
          "hover:border-line hover:bg-surface-2 focus:border-brand focus:outline-none",
          "disabled:opacity-50",
          value === "" ? "text-ink-faint italic" : "text-ink-muted",
        )}
      >
        <option value="">Sem categoria</option>
        {parents.map((parent) => {
          const children = categories.filter((c) => c.parentId === parent.id);
          if (children.length === 0) {
            return (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            );
          }
          return (
            <optgroup key={parent.id} label={parent.name}>
              <option value={parent.id}>{parent.name} (geral)</option>
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {/* Seta discreta, só para o seletor não parecer texto morto. */}
      <span
        className="pointer-events-none absolute right-0.5 text-[9px] text-ink-faint"
        aria-hidden
      >
        ▾
      </span>
    </span>
  );
}
