"use client";

import { useState } from "react";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { monthLabel, monthShortLabel } from "@/domain/month";
import { cn } from "@/lib/utils";
import type { MonthKey } from "@/domain/types";

/** O que o grafico precisa de cada mes (a tela manda so isto ao navegador). */
export interface ColunaDoMes {
  month: MonthKey;
  tipo: "realizado" | "atual" | "previsto";
  receitasCents: number;
  gastosCents: number;
  sobraCents: number;
  parcelasCents: number;
  fixasCents: number;
  diaADiaCents: number;
  /** Quanto do gasto ainda nao aconteceu. */
  gastoPrevistoCents: number;
}

const TIPO = { realizado: "aconteceu", atual: "mês atual, com o que ainda vem", previsto: "previsto" } as const;

/**
 * Entradas e saidas de cada mes: uma coluna empilhada por mes com o que sai
 * (parcelas, contas fixas, dia a dia) e um traco na altura do que entra. O
 * traco acima da coluna e sobra; abaixo, falta.
 *
 * Cores validadas (validate_palette, CVD e visao normal) nos dois temas:
 * laranja das parcelas, verde-agua das contas fixas e o azul da receita
 * (chart-in). O dia a dia e cinza: e o resto, e no futuro e media. O que ainda
 * nao aconteceu e tracejado com fundo claro, na mesma cor - previsto nunca tem
 * cara de fato. A cor nunca esta sozinha: a legenda nomeia cada serie, e a
 * lista abaixo do grafico e a tabela de cada mes.
 *
 * Tocar (ou passar o mouse) num mes mostra os numeros dele em cima.
 */
export function GraficoDosMeses({ colunas, atual }: { colunas: ColunaDoMes[]; atual: MonthKey }) {
  const [selecionado, setSelecionado] = useState<MonthKey>(atual);
  const foco = colunas.find((c) => c.month === selecionado) ?? colunas[0]!;
  const escala = Math.max(1, ...colunas.map((c) => Math.max(c.gastosCents, c.receitasCents)));
  const pct = (cents: number) => `${(Math.max(0, cents) / escala) * 100}%`;

  return (
    <div>
      <div className="mb-3 rounded-(--radius-control) bg-surface-2 px-3 py-2" aria-live="polite">
        <p className="text-legenda text-ink-faint">
          <span className="font-medium text-ink-muted">{monthLabel(foco.month)}</span> · {TIPO[foco.tipo]}
        </p>
        <dl className="tabular mt-0.5 grid grid-cols-3 gap-2 text-corpo">
          <div>
            <dt className="text-legenda text-ink-faint">Entra</dt>
            <dd className="font-semibold text-ink">{formatCentsCompact(foco.receitasCents)}</dd>
          </div>
          <div>
            <dt className="text-legenda text-ink-faint">Sai</dt>
            <dd className="font-semibold text-ink">{formatCentsCompact(foco.gastosCents)}</dd>
          </div>
          <div>
            <dt className="text-legenda text-ink-faint">{foco.sobraCents >= 0 ? "Sobra" : "Falta"}</dt>
            <dd className={cn("font-semibold", foco.sobraCents >= 0 ? "text-positive" : "text-danger")}>
              {formatCentsCompact(Math.abs(foco.sobraCents))}
            </dd>
          </div>
        </dl>
        <a href={`#mes-${foco.month}`} className="mt-1 inline-flex min-h-11 items-center text-corpo font-medium text-brand hover:underline">
          Ver a lista de {monthLabel(foco.month).split(" ")[0]} →
        </a>
      </div>

      <ul className="flex items-end gap-1" style={{ height: "10rem" }} aria-label="Entradas e saídas por mês">
        {colunas.map((c) => {
          const futuro = c.tipo === "previsto";
          // No mes atual, so o que falta sair e tracejado (fica no topo do dia a dia).
          const diaFeito = futuro ? 0 : c.diaADiaCents - c.gastoPrevistoCents;
          const diaPrevisto = futuro ? c.diaADiaCents : c.gastoPrevistoCents;
          const ativo = c.month === selecionado;
          return (
            <li key={c.month} className="h-full min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setSelecionado(c.month)}
                onMouseEnter={() => setSelecionado(c.month)}
                onFocus={() => setSelecionado(c.month)}
                aria-pressed={ativo}
                aria-label={`${monthLabel(c.month)}, ${TIPO[c.tipo]}: entra ${formatCents(c.receitasCents)}, sai ${formatCents(c.gastosCents)} (parcelas ${formatCents(c.parcelasCents)}, contas fixas ${formatCents(c.fixasCents)}, dia a dia ${formatCents(c.diaADiaCents)})`}
                className={cn(
                  "relative flex h-full w-full flex-col justify-end rounded-t-[4px] px-[1px] transition-colors",
                  ativo ? "bg-surface-2" : "hover:bg-surface-2/60",
                )}
              >
                <span className="relative block w-full" style={{ height: pct(c.gastosCents) }}>
                  <span className="absolute inset-0 flex flex-col-reverse gap-[2px]">
                    {segmentos(c, futuro, diaFeito, diaPrevisto).map((seg, i, todos) => (
                      <span
                        key={seg.chave}
                        className={cn(
                          "block w-full shrink-0",
                          seg.previsto ? `border border-dashed ${COR[seg.cor].previsto}` : COR[seg.cor].cheio,
                          // So a ponta de cima da coluna e arredondada.
                          i === todos.length - 1 ? "rounded-t-[4px]" : "",
                        )}
                        style={{ height: `${(seg.cents / c.gastosCents) * 100}%` }}
                      />
                    ))}
                  </span>
                </span>
                {/* O que entra: um traco de 2px na altura da receita. */}
                {c.receitasCents > 0 ? (
                  <span
                    className="pointer-events-none absolute inset-x-0 h-[2px] rounded-full bg-chart-in"
                    style={{ bottom: pct(c.receitasCents) }}
                    aria-hidden
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <ul className="mt-1 flex gap-1" aria-hidden>
        {colunas.map((c) => (
          <li
            key={c.month}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-legenda",
              c.month === selecionado ? "font-semibold text-ink" : "text-ink-faint",
            )}
          >
            {monthShortLabel(c.month).slice(0, 3)}
          </li>
        ))}
      </ul>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-legenda text-ink-muted">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-serie-parcelas" aria-hidden /> Parcelas
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-serie-fixas" aria-hidden /> Contas fixas
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-ink-faint/60" aria-hidden /> Dia a dia
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-[2px] w-3 rounded-full bg-chart-in" aria-hidden /> Entradas
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] border border-dashed border-ink-faint bg-ink-faint/25" aria-hidden /> Previsto
        </li>
      </ul>
    </div>
  );
}

const COR = {
  parcelas: { cheio: "bg-serie-parcelas", previsto: "border-serie-parcelas bg-serie-parcelas/40" },
  fixas: { cheio: "bg-serie-fixas", previsto: "border-serie-fixas bg-serie-fixas/40" },
  dia: { cheio: "bg-ink-faint/60", previsto: "border-ink-faint bg-ink-faint/25" },
} as const;

/** De baixo para cima: parcelas, contas fixas, dia a dia feito, dia a dia previsto. */
function segmentos(c: ColunaDoMes, futuro: boolean, diaFeito: number, diaPrevisto: number) {
  return [
    { chave: "parcelas", cents: c.parcelasCents, cor: "parcelas" as const, previsto: futuro },
    { chave: "fixas", cents: c.fixasCents, cor: "fixas" as const, previsto: futuro },
    { chave: "dia", cents: diaFeito, cor: "dia" as const, previsto: false },
    { chave: "dia-previsto", cents: diaPrevisto, cor: "dia" as const, previsto: true },
  ].filter((seg) => seg.cents > 0 && c.gastosCents > 0);
}
