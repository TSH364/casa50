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
    <span className="relative inline-flex min-w-0 max-w-full items-center">
      <span
        className="pointer-events-none absolute left-2 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: chosen?.color ?? "var(--color-line-strong, #55555c)" }}
        aria-hidden
      />
      <select
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        aria-label={`Categoria de ${description}`}
        className={cn(
          // Borda sempre visível: sem ela o seletor parecia texto morto e
          // ninguém descobria que dava para tocar. Alvo de 32px de altura,
          // que é o mínimo confortável dentro de uma linha de lista.
          "min-h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-full",
          "border border-line bg-surface-2 py-1 pl-6 pr-6 text-[13px]",
          "transition-colors hover:border-line-strong focus:border-brand focus:outline-none",
          "disabled:opacity-50",
          value === "" ? "text-ink-faint" : "text-ink",
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
      <span
        className="pointer-events-none absolute right-2 text-[10px] text-ink-faint"
        aria-hidden
      >
        ▾
      </span>
    </span>
  );
}
