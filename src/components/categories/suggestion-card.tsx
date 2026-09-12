"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Undo2, X } from "lucide-react";
import {
  acceptSubcategorySuggestion,
  dismissSubcategorySuggestion,
  restoreSubcategorySuggestion,
} from "@/actions/subcategories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { formatCents } from "@/lib/money";
import type { SubcategorySuggestion } from "@/domain/subcategories";

/**
 * Uma proposta, com a evidencia que a sustenta.
 *
 * O nome vem preenchido e editavel: "Rotina de dia util" e um chute razoavel,
 * mas quem sabe como chama esse gasto e a casa. E a lista de estabelecimentos
 * fica a vista porque e ela que deixa conferir - a proposta se defende pelo
 * dado, nao pela confianca no app.
 */

function porcento(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function SuggestionCard({
  categoryId,
  categoryName,
  color,
  suggestion,
}: {
  categoryId: string;
  categoryName: string;
  color: string;
  suggestion: SubcategorySuggestion;
}) {
  const [name, setName] = useState(suggestion.suggestedName);
  const [pending, startTransition] = useTransition();
  // Some da tela no ato. A pagina revalida logo atras; sem isto a proposta
  // aceita ficaria piscando ate a revalidacao chegar.
  const [resolvida, setResolvida] = useState(false);

  if (resolvida) return null;

  function aceitar() {
    startTransition(async () => {
      const result = await acceptSubcategorySuggestion({
        categoryId,
        name,
        merchants: suggestion.merchants.map((m) => m.merchant),
      });
      if (result.error) toast.error(result.error);
      else {
        setResolvida(true);
        toast.success(
          `${name} criada em ${categoryName}` +
            (result.count
              ? `, com ${result.count} lançamento(s) já classificados.`
              : "."),
        );
      }
    });
  }

  function recusar() {
    startTransition(async () => {
      const result = await dismissSubcategorySuggestion({
        categoryId,
        suggestionKey: suggestion.key,
      });
      if (result.error) toast.error(result.error);
      else {
        setResolvida(true);
        toast.success("Proposta guardada como recusada.");
      }
    });
  }

  return (
    <div className="rounded-[--radius-control] bg-surface-2 px-3 py-3">
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 break-words text-[13px] text-ink-faint">
          em {categoryName}
        </span>
      </div>

      <label className="mt-2 block">
        <span className="sr-only">Nome da subcategoria</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          disabled={pending}
        />
      </label>

      {/* A evidencia, em numeros que se conferem no extrato. */}
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-muted">
        <span className="tabular">
          {suggestion.count} lançamentos em {suggestion.monthsSeen} meses
        </span>
        <span className="tabular">{formatCents(suggestion.totalCents)}</span>
        <span className="tabular">
          normalmente {formatCents(suggestion.medianCents)}
        </span>
        <span className="tabular">
          {porcento(suggestion.weekdayShare)} em dia útil
        </span>
      </p>

      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-ink-faint">
          Ver os {suggestion.merchants.length} estabelecimentos
        </summary>
        <ul className="mt-1.5 space-y-1">
          {suggestion.merchants.map((m) => (
            <li
              key={m.merchant}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]"
            >
              <span className="min-w-0 break-words text-ink">{m.label}</span>
              <span className="tabular text-ink-faint">
                {m.count}× · {formatCents(m.totalCents)} ·{" "}
                {porcento(m.weekdayShare)} em dia útil
              </span>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || !name.trim()} onClick={aceitar}>
          <Check aria-hidden /> Criar subcategoria
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={recusar}
        >
          <X aria-hidden /> Agora não
        </Button>
      </div>
    </div>
  );
}

export function RestoreDismissed({
  categoryId,
  suggestionKey,
}: {
  categoryId: string;
  suggestionKey: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className="inline-flex items-center gap-1 text-brand underline-offset-4 hover:underline disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          const result = await restoreSubcategorySuggestion({
            categoryId,
            suggestionKey,
          });
          if (result.error) toast.error(result.error);
          else toast.success("Proposta de volta na lista.");
        })
      }
    >
      <Undo2 className="size-3" aria-hidden /> trazer de volta
    </button>
  );
}
