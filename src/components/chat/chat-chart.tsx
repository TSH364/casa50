"use client";

import { useState } from "react";
import type { ChartSpec } from "@/domain/chat";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Um grafico da conversa (secao 16).
 *
 * Sempre uma serie so, entao uma cor so - a da marca, conferida com o
 * validador de paleta contra o fundo da bolha nos dois temas (contraste >= 3:1)
 * - e nenhuma legenda: o titulo diz o que esta desenhado.
 *
 * Em HTML, e nao SVG escalado: assim a barra tem a espessura certa (no
 * maximo 24px, ponta arredondada de 4px) em qualquer largura de tela, sem
 * esticar junto com o viewBox.
 *
 * Toque, passar o mouse ou focar pelo teclado mostram o valor na linha de
 * leitura; "Ver tabela" mostra todos. Nada depende de hover.
 */

const MIL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/**
 * "11,1 mil" em vez de "R$ 11.059": o rotulo vai sobre uma coluna de ~45px no
 * celular, e o valor inteiro esta na leitura e na tabela.
 */
function curto(cents: number): string {
  const reais = cents / 100;
  return reais >= 1000 ? `${MIL.format(reais / 1000)} mil` : formatCentsCompact(cents);
}

export function ChatChart({ chart, printTable = false }: { chart: ChartSpec; printTable?: boolean }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const max = Math.max(...chart.points.map((p) => p.cents), 1);
  const leitura = ativo !== null ? chart.points[ativo] : null;

  // Colunas: rotulo so no maior e no ultimo - um numero em cada coluna nao
  // se le. Os outros ficam na leitura e na tabela.
  const iMaior = chart.points.reduce((m, p, i, a) => (p.cents > a[m]!.cents ? i : m), 0);
  const iUltimo = chart.points.length - 1;

  return (
    <figure className="mt-2 rounded-xl border border-line bg-surface-2 px-3 py-3 text-ink">
      <figcaption>
        <p className="text-[13px] font-medium">{chart.title}</p>
        <p className="text-[12px] text-ink-muted">{chart.subtitle}</p>
      </figcaption>

      {/* A linha de leitura: o valor do que esta tocado, ou a dica de tocar. */}
      <p className="tabular mt-2 min-h-5 text-[12px] text-ink-muted" aria-live="polite">
        {leitura ? (
          <>
            <span className="font-semibold text-ink">{formatCents(leitura.cents)}</span> · {leitura.label}
          </>
        ) : (
          "Toque numa barra para ver o valor."
        )}
      </p>

      {chart.kind === "colunas" ? (
        <div className="mt-1 flex h-40 items-end gap-0.5" role="list">
          {chart.points.map((p, i) => {
            const altura = Math.max((p.cents / max) * 100, p.cents > 0 ? 2 : 0);
            const rotular = i === iMaior || i === iUltimo;
            return (
              <button
                key={i}
                type="button"
                role="listitem"
                aria-label={`${p.label}: ${formatCents(p.cents)}`}
                onPointerEnter={() => setAtivo(i)}
                onFocus={() => setAtivo(i)}
                onClick={() => setAtivo(i)}
                // O alvo e a faixa inteira da coluna, nao so a barra pintada.
                className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-offset-2"
              >
                {rotular ? (
                  <span className="tabular mb-0.5 whitespace-nowrap text-[10px] text-ink-muted">
                    {curto(p.cents)}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "block w-full max-w-6 rounded-t bg-brand transition-opacity",
                    ativo === i ? "opacity-100" : "opacity-90 group-hover:opacity-100",
                  )}
                  style={{ height: `${altura}%` }}
                />
              </button>
            );
          })}
        </div>
      ) : (
        <ul className="mt-1 space-y-2">
          {chart.points.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                aria-label={`${p.label}: ${formatCents(p.cents)}`}
                onPointerEnter={() => setAtivo(i)}
                onFocus={() => setAtivo(i)}
                onClick={() => setAtivo(i)}
                className="group block w-full text-left outline-offset-2"
              >
                <span className="block truncate text-[12px] text-ink">{p.label}</span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span
                    className={cn(
                      "block h-3 rounded-r bg-brand transition-opacity",
                      ativo === i ? "opacity-100" : "opacity-90 group-hover:opacity-100",
                    )}
                    style={{ width: `${Math.max((p.cents / max) * 78, p.cents > 0 ? 1 : 0)}%` }}
                  />
                  {/* Valor na ponta, em tinta de texto - nunca na cor da barra. */}
                  <span className="tabular shrink-0 text-[11px] text-ink-muted">{formatCentsCompact(p.cents)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {chart.kind === "colunas" ? (
        // Os meses do eixo, sob cada coluna.
        <div className="mt-1 flex gap-0.5" aria-hidden>
          {chart.points.map((p, i) => (
            <span key={i} className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-muted">
              {p.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* No PDF a tabela vai aberta: <details> fechado nao imprime o conteudo. */}
      {printTable ? (
        <div className="mt-2">
          <table className="mt-1 w-full text-[12px]">
          <tbody>
            {chart.points.map((p, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-2 text-ink">{p.label}</td>
                <td className="tabular py-1 text-right text-ink">{formatCents(p.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] text-ink-muted">Ver tabela</summary>
          <table className="mt-1 w-full text-[12px]">
          <tbody>
            {chart.points.map((p, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-2 text-ink">{p.label}</td>
                <td className="tabular py-1 text-right text-ink">{formatCents(p.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </details>
      )}
    </figure>
  );
}
