"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { monthLabel, monthShortLabel } from "@/domain/month";
import { cn } from "@/lib/utils";
import type { MesProjetado } from "@/domain/projecao";
import type { MonthKey } from "@/domain/types";

/**
 * Recebe x gasta, mes a mes: duas colunas por mes, azul e vermelha, como em
 * Extratos.
 *
 * Nove meses com dois valores cada nao cabem escritos embaixo das colunas no
 * celular. Como no mapa de fluxo, existe UM lugar para os numeros, acima do
 * grafico, e o toque escolhe o mes. O mes atual comeca selecionado.
 *
 * Previsto nunca tem o preenchimento solido do que ja aconteceu: borda
 * tracejada e fundo claro, da mesma cor.
 */
export function ProjecaoBarras({ meses, atual }: { meses: MesProjetado[]; atual: MonthKey }) {
  const [selecionado, setSelecionado] = useState<MonthKey>(atual);
  const max = Math.max(1, ...meses.flatMap((m) => [m.receitasCents, m.gastosCents]));
  const foco = meses.find((m) => m.month === selecionado) ?? meses[0]!;
  const previsto = foco.tipo !== "realizado";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-corpo text-ink">
          <span className="font-medium">{monthLabel(foco.month)}</span>
          <span className="text-ink-faint">
            {foco.tipo === "realizado" ? " · consolidado" : foco.tipo === "atual" ? " · mês atual (previsto)" : " · previsto"}
          </span>
        </p>
        <dl className="tabular flex flex-wrap gap-x-4 text-corpo">
          <div className="flex gap-1">
            <dt className="text-ink-faint">Recebe</dt>
            <dd className="text-info">{formatCents(foco.receitasCents)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-ink-faint">Gasta</dt>
            <dd className="text-danger">{formatCents(foco.gastosCents)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-ink-faint">{foco.sobraCents >= 0 ? "Sobra" : "Falta"}</dt>
            <dd className={cn("font-semibold", foco.sobraCents >= 0 ? "text-positive" : "text-danger")}>
              {formatCents(Math.abs(foco.sobraCents))}
            </dd>
          </div>
        </dl>
      </div>

      <ul className="flex items-end gap-1.5" style={{ height: "9rem" }} aria-label="Recebe e gasta por mês">
        {meses.map((m) => {
          const ativo = m.month === selecionado;
          const prev = m.tipo !== "realizado";
          const descricao = `${monthLabel(m.month)}${prev ? " (previsto)" : ""}: recebe ${formatCents(m.receitasCents)}, gasta ${formatCents(m.gastosCents)}`;
          return (
            <li key={m.month} className="flex h-full min-w-0 flex-1 flex-col gap-1">
              <button
                type="button"
                onClick={() => setSelecionado(m.month)}
                aria-pressed={ativo}
                title={descricao}
                className={cn(
                  "flex h-full min-h-0 flex-1 cursor-pointer items-end justify-center gap-[2px] rounded-t-[4px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  ativo && "bg-surface-2",
                )}
              >
                <span className="sr-only">{descricao}</span>
                {[
                  { cents: m.receitasCents, cor: "chart-in" },
                  { cents: m.gastosCents, cor: "chart-out" },
                ].map((b) => (
                  <span
                    key={b.cor}
                    aria-hidden
                    className={cn(
                      "block w-[42%] max-w-4 rounded-t-[4px]",
                      prev
                        ? b.cor === "chart-in"
                          ? "border border-dashed border-chart-in bg-chart-in/35"
                          : "border border-dashed border-chart-out bg-chart-out/35"
                        : b.cor === "chart-in"
                          ? "bg-chart-in"
                          : "bg-chart-out",
                      !ativo && !prev && "opacity-80",
                    )}
                    style={{ height: `${Math.max(1.5, (b.cents / max) * 100)}%` }}
                  />
                ))}
              </button>
              <span
                aria-hidden
                className={cn(
                  "block truncate text-center text-[10px]",
                  ativo ? "font-medium text-ink-muted" : "text-ink-faint",
                  m.tipo === "atual" && "text-ink",
                )}
              >
                {monthShortLabel(m.month)}
              </span>
            </li>
          );
        })}
      </ul>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-legenda text-ink-faint">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-chart-in" aria-hidden /> Recebe
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-chart-out" aria-hidden /> Gasta
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] border border-dashed border-ink-faint" aria-hidden /> Tracejado = previsto
        </li>
        {previsto && foco.temEstimativa ? <li>O gasto previsto inclui a média do variável.</li> : null}
      </ul>
    </div>
  );
}
