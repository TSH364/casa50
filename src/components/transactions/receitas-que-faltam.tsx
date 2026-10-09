"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { monthLabel } from "@/domain/month";
import { formatBRL } from "@/lib/money";
import type { ModeloDeReceita } from "@/domain/receitas-do-mes";
import type { Card, Category } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";
import { TransactionFormDialog } from "./transaction-form";

/**
 * As receitas de todo mes que ainda nao entraram no mes da tela, uma linha
 * so acima da lista. O toque abre o formulario ja preenchido com o ultimo
 * mes (nome, valor, categoria, quem recebeu, dia): a casa confere o valor e
 * confirma. Nada e lancado sozinho - o valor "quase igual" ainda e quase.
 */
export function ReceitasQueFaltam({
  faltam,
  modelos,
  month,
  categories,
  cards,
  members,
}: {
  faltam: ModeloDeReceita[];
  modelos: ModeloDeReceita[];
  month: string;
  categories: Category[];
  cards: Card[];
  members: MemberSummary[];
}) {
  const [abrindo, setAbrindo] = useState<ModeloDeReceita | undefined>();
  if (faltam.length === 0) return null;

  return (
    <div className="mb-3 rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
      <p className="text-legenda text-ink-muted">Receitas de todo mês que faltam em {monthLabel(month)}</p>
      {/* Uma linha so, rolando de lado: empilhadas, tres receitas empurravam
          a lista para baixo - o que a casa pediu para nao acontecer. */}
      <ul className="-mx-3 mt-1.5 flex gap-1.5 overflow-x-auto px-3 pb-0.5">
        {faltam.map((m) => (
          <li key={m.chave} className="shrink-0">
            <button
              type="button"
              onClick={() => setAbrindo(m)}
              aria-label={`Lançar ${m.description}, ${formatBRL(m.amount)}`}
              className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-legenda text-ink transition-colors hover:border-info"
            >
              <Plus className="size-3.5 text-info" aria-hidden />
              {m.description}
              <span className="tabular text-info">{formatBRL(m.amount)}</span>
            </button>
          </li>
        ))}
      </ul>
      {abrindo ? (
        <TransactionFormDialog
          key={abrindo.chave}
          open
          onOpenChange={(open) => {
            if (!open) setAbrindo(undefined);
          }}
          categories={categories}
          cards={cards}
          members={members}
          defaultMonth={month}
          modelos={modelos}
          modelo={abrindo}
        />
      ) : null}
    </div>
  );
}
