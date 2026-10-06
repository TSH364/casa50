"use client";

import { useState } from "react";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { monthLabel, monthShortLabel } from "@/domain/month";
import { cn } from "@/lib/utils";
import type { MesProjetado } from "@/domain/projecao";
import type { MonthKey } from "@/domain/types";

/**
 * Quanto sobra em cada mes: uma coluna por mes, acima da linha do zero
 * quando sobra (azul, o dinheiro que fica), abaixo quando falta (vermelho).
 * Verde e vermelho nao passaram na conferencia de daltonismo; azul e
 * vermelho (os tokens chart-in/out) passaram nos dois temas.
 *
 * Era recebe x gasta lado a lado - mas a receita da casa e quase fixa, e
 * nove colunas azuis da mesma altura nao diziam nada. A sobra e o que muda
 * de um mes para outro, e o que responde "da para comprar?". Recebe e gasta
 * continuam a um toque: o mes escolhido mostra os tres numeros em cima.
 *
 * Previsto nunca tem o preenchimento solido do que ja aconteceu: borda
 * tracejada e fundo claro, da mesma cor.
 */
export function ProjecaoBarras({ meses, atual }: { meses: MesProjetado[]; atual: MonthKey }) {
  const [selecionado, setSelecionado] = useState<MonthKey>(atual);
  const foco = meses.find((m) => m.month === selecionado) ?? meses[0]!;
  const maxPos = Math.max(0, ...meses.map((m) => m.sobraCents));
  const maxNeg = Math.max(0, ...meses.map((m) => -m.sobraCents));
  const escala = Math.max(1, maxPos + maxNeg);
  // A linha do zero fica onde a proporcao manda: sem mes negativo, no chao.
  const acima = maxPos / escala;

  return (
    <div>
      <div className="mb-3 rounded-(--radius-control) bg-surface-2 px-3 py-2">
        <p className="text-legenda text-ink-faint">
          <span className="font-medium text-ink-muted">{monthLabel(foco.month)}</span>
          {foco.tipo === "realizado" ? " · aconteceu" : foco.tipo === "atual" ? " · mês atual, com o que ainda vem" : " · previsto"}
        </p>
        <dl className="tabular mt-0.5 grid grid-cols-3 gap-2 text-corpo">
          <div>
            <dt className="text-legenda text-ink-faint">Recebe</dt>
            <dd className="text-info">{formatCentsCompact(foco.receitasCents)}</dd>
          </div>
          <div>
            <dt className="text-legenda text-ink-faint">Gasta</dt>
            <dd className="text-danger">{formatCentsCompact(foco.gastosCents)}</dd>
          </div>
          <div>
            <dt className="text-legenda text-ink-faint">{foco.sobraCents >= 0 ? "Sobra" : "Falta"}</dt>
            <dd className={cn("font-semibold", foco.sobraCents >= 0 ? "text-positive" : "text-danger")}>
              {formatCentsCompact(Math.abs(foco.sobraCents))}
            </dd>
          </div>
        </dl>
      </div>

      <ul className="relative flex gap-1.5" style={{ height: "8.5rem" }} aria-label="Sobra por mês">
        {/* A linha do zero, atras das colunas. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-line-strong"
          style={{ top: `${acima * 100}%` }}
        />
        {meses.map((m) => {
          const ativo = m.month === selecionado;
          const prev = m.tipo !== "realizado";
          const positivo = m.sobraCents >= 0;
          const altura = (Math.abs(m.sobraCents) / escala) * 100;
          const descricao = `${monthLabel(m.month)}${prev ? " (previsto)" : ""}: ${positivo ? "sobra" : "falta"} ${formatCents(Math.abs(m.sobraCents))}`;
          return (
            <li key={m.month} className="relative h-full min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setSelecionado(m.month)}
                aria-pressed={ativo}
                title={descricao}
                className={cn(
                  "absolute inset-0 cursor-pointer rounded-[4px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  ativo && "bg-surface-2",
                )}
              >
                <span className="sr-only">{descricao}</span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 w-[62%] max-w-6 -translate-x-1/2",
                    positivo ? "rounded-t-[4px]" : "rounded-b-[4px]",
                    prev
                      ? positivo
                        ? "border border-dashed border-chart-in bg-chart-in/30"
                        : "border border-dashed border-chart-out bg-chart-out/30"
                      : positivo
                        ? "bg-chart-in"
                        : "bg-chart-out",
                  )}
                  style={
                    positivo
                      ? { bottom: `${(1 - acima) * 100}%`, height: `${Math.max(1.5, altura)}%` }
                      : { top: `${acima * 100}%`, height: `${Math.max(1.5, altura)}%` }
                  }
                />
              </button>
            </li>
          );
        })}
      </ul>
      <ul className="mt-1 flex gap-1.5" aria-hidden>
        {meses.map((m) => (
          <li
            key={m.month}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[10px]",
              m.month === selecionado ? "font-semibold text-ink" : m.tipo === "atual" ? "text-ink-muted" : "text-ink-faint",
            )}
          >
            {monthShortLabel(m.month)}
          </li>
        ))}
      </ul>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-legenda text-ink-faint">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-chart-in" aria-hidden /> Sobra
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-chart-out" aria-hidden /> Falta
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] border border-dashed border-ink-faint" aria-hidden /> Tracejado = previsto
        </li>
        <li>Toque num mês para ver quanto entra e sai.</li>
      </ul>
    </div>
  );
}
