"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ArrowRight } from "lucide-react";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CategoryItem } from "@/domain/finance";
import type { MonthKey } from "@/domain/types";

export interface CategoryRow {
  categoryId: string | null;
  name: string;
  color: string;
  totalCents: number;
  share: number;
  count: number;
  items: CategoryItem[];
}

const DIA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

/**
 * A lista de categorias, que abre para mostrar do que o número é feito.
 *
 * Uma rosca responde "qual fatia é maior" e para por aí. A pergunta seguinte
 * é sempre "o que tem dentro?", e até aqui ela exigia sair da tela, ir para
 * Extratos e montar o filtro à mão. Agora abre no lugar.
 *
 * Abre uma de cada vez: duas categorias abertas empurram a segunda para fora
 * da tela do celular, e a comparação que a lista existe para permitir se
 * perde.
 */
export function CategoryRows({
  rows,
  month,
}: {
  rows: CategoryRow[];
  month: MonthKey;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="min-w-0 flex-1 space-y-1">
      {rows.map((row) => {
        const key = row.categoryId ?? "sem-categoria";
        const isOpen = open === key;
        return (
          <li key={key} className="rounded-[--radius-control]">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : key)}
              aria-expanded={isOpen}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[--radius-control] px-2 py-2 text-left transition-colors",
                isOpen ? "bg-surface-2" : "hover:bg-surface-2",
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {row.name}
              </span>
              <span className="shrink-0 text-[12px] text-ink-faint">
                {Math.round(row.share * 100)}%
              </span>
              <span className="tabular shrink-0 text-sm font-medium text-ink">
                {formatCents(row.totalCents)}
              </span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "size-3.5 shrink-0 text-ink-faint transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>

            {isOpen ? (
              <div className="px-2 pb-2 pt-1">
                <ul className="space-y-1 border-l border-line pl-3">
                  {row.items.slice(0, 12).map((item) => (
                    <li
                      key={item.id}
                      className="flex items-baseline gap-2 text-[13px]"
                    >
                      <span className="tabular shrink-0 text-[11px] text-ink-faint">
                        {DIA.format(new Date(`${item.date}T00:00:00Z`))}
                      </span>
                      {/*
                        Quebra em vez de cortar: a 360px "RESTAURANTE E
                        LANCHONETE DO PORTO" vira "RESTAURANTE E LANCH…", e
                        num detalhe que existe justamente para dizer O QUE foi
                        comprado, o nome cortado devolve a dúvida que a lista
                        veio resolver. Duas linhas custam altura; reticências
                        custam a informação.
                      */}
                      <span className="min-w-0 flex-1 break-words leading-snug text-ink-muted">
                        {item.description}
                        {item.installment ? (
                          <span className="ml-1 text-ink-faint">
                            {item.installment}
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular shrink-0 text-ink">
                        {formatCents(item.spendCents)}
                      </span>
                    </li>
                  ))}
                </ul>

                {/*
                  A lista para em 12 e diz que parou. Mostrar 40 linhas dentro
                  de um card de resumo transformaria o resumo noutra coisa; e
                  Extratos já sabe filtrar por categoria e mês.
                */}
                <Link
                  href={`/extratos?mes=${month}&categoria=${row.categoryId ?? "sem"}`}
                  className="mt-2 inline-flex items-center gap-1 pl-3 text-[12px] text-brand hover:underline"
                >
                  {row.items.length > 12
                    ? `Ver os ${row.count} lançamentos`
                    : "Abrir em Extratos"}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
