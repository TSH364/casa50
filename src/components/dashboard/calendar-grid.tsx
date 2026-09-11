"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DaySpend } from "@/domain/finance";
import type { MonthKey } from "@/domain/types";

export interface CalendarDay extends DaySpend {
  /** Compromissos da agenda que caem neste dia. */
  events: string[];
  items: { id: string; description: string; spendCents: number }[];
}

const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"] as const;

/** Fundo de cada passo. O dia sem gasto nao recebe cor nenhuma. */
const FUNDO = [
  "transparent",
  "var(--color-day-1)",
  "var(--color-day-2)",
  "var(--color-day-3)",
  "var(--color-day-4)",
] as const;

/**
 * A tinta do numero inverte no meio da rampa.
 *
 * Com uma cor so, o numero do dia sumia no topo: `ink` sobre o passo 4 da
 * 2,85:1, abaixo de qualquer minimo. Assim os quatro passos ficam em AA.
 */
const TINTA = [
  "text-ink-faint",
  "text-ink",
  "text-ink",
  "text-canvas",
  "text-canvas",
] as const;

const INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const MILHAR = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/**
 * Valor do dia em ~4 caracteres, numa celula de 39px.
 *
 * Feito a mao em vez de `notation: "compact"` porque o compacto do Intl so
 * abrevia a partir de mil, e a grade ficava misturando "418,9" com "2,5 mil"
 * - duas unidades diferentes lado a lado, sem nada dizendo qual e qual.
 * Aqui o corte e unico: abaixo de mil, reais inteiros; acima, "x,y mil".
 * Centavos nao cabem nem informam neste tamanho, e o valor exato esta no
 * toque e no leitor de tela.
 */
function curto(cents: number): string {
  const reais = cents / 100;
  if (reais < 1000) return INTEIRO.format(reais);
  return `${MILHAR.format(reais / 1000)} mil`;
}

/**
 * Calendario de gastos do mes (secao 7).
 *
 * O mapa de fluxo responde "como este mes se compara aos outros". Este
 * responde o que nenhuma barra mensal alcanca: COMO o gasto se distribuiu
 * dentro do mes - se foi um pico num sabado, um gotejar diario, ou duas
 * semanas apagadas seguidas de uma cara.
 *
 * A intensidade e sequencial num matiz so, e nunca age sozinha: todo dia
 * mostra o numero, e os dias com gasto mostram o valor. Cor aqui acelera a
 * leitura; ela nao E a leitura.
 */
export function CalendarGrid({
  days,
  month,
}: {
  days: CalendarDay[];
  month: MonthKey;
}) {
  const [aberto, setAberto] = useState<string | null>(null);

  // Quantas celulas vazias antes do dia 1, para a coluna do dia da semana
  // bater. `T00:00:00Z` com fuso UTC: sem isso, em Brasilia o dia 1 cai no
  // dia anterior e o mes inteiro anda uma casa.
  const primeiro = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const selecionado = days.find((d) => d.date === aberto) ?? null;

  return (
    <>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Gasto por dia">
        {SEMANA.map((letra, i) => (
          <div
            key={i}
            className="pb-0.5 text-center text-[10px] font-medium text-ink-faint"
            aria-hidden
          >
            {letra}
          </div>
        ))}

        {Array.from({ length: primeiro }, (_, i) => (
          <div key={`vazio-${i}`} aria-hidden />
        ))}

        {days.map((d) => {
          const isOpen = d.date === aberto;
          const rotulo =
            d.totalCents > 0
              ? `Dia ${d.day}: ${formatCents(d.totalCents)} em ${d.count} ${d.count === 1 ? "lançamento" : "lançamentos"}`
              : `Dia ${d.day}: sem gasto`;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setAberto(isOpen ? null : d.date)}
              aria-label={rotulo}
              aria-pressed={isOpen}
              title={rotulo}
              className={cn(
                "relative flex aspect-square min-h-[38px] flex-col items-center justify-center rounded-[--radius-control] transition-shadow",
                d.step === 0 && "border border-line",
                isOpen && "ring-2 ring-ink",
              )}
              style={{ backgroundColor: FUNDO[d.step] }}
            >
              <span className={cn("text-[11px] font-medium leading-none", TINTA[d.step])}>
                {d.day}
              </span>
              {d.totalCents > 0 ? (
                <span
                  className={cn("tabular mt-0.5 text-[9px] leading-none", TINTA[d.step])}
                >
                  {curto(d.totalCents)}
                </span>
              ) : null}
              {d.events.length > 0 ? (
                <span
                  aria-hidden
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-attention"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {selecionado ? (
        <div className="mt-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5">
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-ink">Dia {selecionado.day}</span>
            <span className="tabular text-sm font-medium text-ink">
              {selecionado.totalCents > 0
                ? formatCents(selecionado.totalCents)
                : "sem gasto"}
            </span>
          </p>

          {selecionado.events.length > 0 ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-attention">
              <CalendarDays className="size-3 shrink-0" aria-hidden />
              {selecionado.events.join(" · ")}
            </p>
          ) : null}

          {selecionado.items.length > 0 ? (
            <>
              <ul className="mt-2 space-y-1 border-l border-line pl-3">
                {selecionado.items.slice(0, 8).map((item) => (
                  <li key={item.id} className="flex items-baseline gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 break-words leading-snug text-ink-muted">
                      {item.description}
                    </span>
                    <span className="tabular shrink-0 text-ink">
                      {formatCents(item.spendCents)}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href={`/extratos?mes=${month}`}
                className="mt-2 inline-flex items-center gap-1 pl-3 text-[12px] text-brand hover:underline"
              >
                {selecionado.items.length > 8
                  ? `Ver os ${selecionado.count} lançamentos`
                  : "Abrir em Extratos"}
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[12px] text-ink-faint">
        <span>Menos</span>
        {[1, 2, 3, 4].map((s) => (
          <span
            key={s}
            className="size-3.5 rounded-[3px]"
            style={{ backgroundColor: FUNDO[s] }}
            aria-hidden
          />
        ))}
        <span>Mais</span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-attention" aria-hidden />
          tem compromisso na agenda
        </span>
      </div>
    </>
  );
}
