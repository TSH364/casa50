"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { monthLabel, monthShortLabel } from "@/domain/month";
import { cn } from "@/lib/utils";
import type { MonthKey } from "@/domain/types";

export interface FlowBar {
  month: MonthKey;
  cents: number;
  isForecast: boolean;
}

/**
 * As colunas do mapa de fluxo, com toque para ver o valor.
 *
 * O valor de cada mês não cabe escrito embaixo da própria coluna — nove
 * colunas dividindo 360px dão 30px cada, e "R$ 17.129" precisa de uns 50px.
 * Em vez de encavalar nove rótulos, existe UM lugar para o número, acima do
 * gráfico, e o toque decide de qual mês ele fala.
 *
 * O mês em foco começa selecionado, então a tela abre respondendo à pergunta
 * mais provável sem exigir nenhum toque.
 */
export function FlowBars({
  bars,
  month,
}: {
  bars: FlowBar[];
  month: MonthKey;
}) {
  const [selected, setSelected] = useState<MonthKey>(month);
  const max = Math.max(...bars.map((b) => b.cents), 1);
  const atual = bars.find((b) => b.month === selected) ?? bars.find((b) => b.month === month);

  return (
    <>
      <p className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="tabular text-lg font-semibold text-ink">
          {formatCents(atual?.cents ?? 0)}
        </span>
        <span className="text-[12px] text-ink-faint">
          em {monthLabel(atual?.month ?? month)}
          {atual?.isForecast ? " · previsto" : ""}
        </span>
      </p>

      <ul className="flex items-end gap-1.5" style={{ height: "8rem" }}>
        {bars.map((bar) => {
          const height = Math.max(2, (bar.cents / max) * 100);
          const isSelected = bar.month === selected;
          const descricao = `${monthLabel(bar.month)}: ${formatCents(bar.cents)}${
            bar.isForecast ? " (previsto)" : ""
          }`;
          return (
            <li key={bar.month} className="flex h-full min-w-0 flex-1 flex-col gap-1">
              {/*
                O botão ocupa a coluna inteira, e não só o retângulo colorido:
                num mês de gasto baixo a barra tem 4px de altura, e mirar nela
                com o dedo seria impossível. A área de toque vai do topo do
                trilho até o rótulo.
              */}
              <button
                type="button"
                onClick={() => setSelected(bar.month)}
                aria-pressed={isSelected}
                title={descricao}
                className="group flex h-full min-h-0 flex-1 cursor-pointer flex-col justify-end rounded-t-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span className="sr-only">{descricao}</span>
                <span
                  aria-hidden
                  className={cn(
                    "block w-full rounded-t-[3px] transition-colors",
                    bar.isForecast
                      ? // Hachura: previsão nunca ganha o mesmo preenchimento
                        // sólido de um mês que realmente aconteceu.
                        "border border-dashed border-brand/60 bg-brand/15"
                      : isSelected
                        ? "bg-brand"
                        : "bg-brand/50 group-hover:bg-brand/70",
                    bar.isForecast && isSelected && "bg-brand/30",
                  )}
                  style={{ height: `${height}%` }}
                />
              </button>
              <span
                aria-hidden
                className={cn(
                  "block truncate text-center text-[10px]",
                  isSelected ? "font-medium text-ink-muted" : "text-ink-faint",
                )}
              >
                {monthShortLabel(bar.month)}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
