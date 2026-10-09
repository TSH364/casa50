import { formatCents, formatCentsCompact } from "@/lib/money";
import { lerEvidencia, type EvidenciaLida } from "@/domain/evidencia";
import type { InsightTone } from "@/domain/insights";
import { cn } from "@/lib/utils";
import { MedidaBar, TONE } from "./insight-card";

/**
 * Os fatos que sustentam uma analise da IA, desenhados:
 *
 *   - comparacao (categoria x media, gasto x limite, conta x cadastrada): a
 *     mesma barra das observacoes do app, com a diferenca escrita;
 *   - lojas e valores: barras na mesma escala - a da maior loja, ou a da
 *     categoria quando a analise tambem cita a categoria (a Leroy aparece
 *     como pedaco do gasto com Casa);
 *   - parte do todo ("41% do gasto"): uma barra de 0 a 100%;
 *   - o resto continua texto, em linhas.
 */
export function EvidenciasDaIa({
  evidence,
  tone,
}: {
  evidence: { label: string; value: string }[];
  tone: InsightTone;
}) {
  const lidas = evidence.map((e) => lerEvidencia(e.label, e.value));
  const escalaValores = Math.max(
    1,
    ...lidas.flatMap((l) =>
      l.tipo === "valor" ? [l.cents] : l.tipo === "comparacao" ? [l.medida.atualCents] : [],
    ),
  );

  return (
    <div className="mt-3 space-y-3 rounded-(--radius-control) bg-surface px-3 py-2.5">
      {lidas.map((l, i) => (
        <Evidencia key={i} lida={l} tone={tone} escala={escalaValores} />
      ))}
    </div>
  );
}

function Evidencia({ lida: l, tone, escala }: { lida: EvidenciaLida; tone: InsightTone; escala: number }) {
  const tom = TONE[tone];
  switch (l.tipo) {
    case "comparacao":
      return (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-legenda font-medium text-ink">{l.titulo}</p>
            {l.diferenca ? (
              <span className={cn("tabular shrink-0 rounded-full px-2 py-0.5 text-legenda font-medium", tom.pill)}>
                {l.diferenca}
              </span>
            ) : null}
          </div>
          <MedidaBar tone={tone} medida={l.medida} />
          {l.notas.length > 0 ? <p className="mt-1 text-legenda text-ink-faint">{l.notas.join(" · ")}</p> : null}
        </div>
      );
    case "valor":
      return (
        <div>
          <div className="flex items-baseline justify-between gap-2 text-legenda">
            <p className="min-w-0 truncate text-ink">{l.titulo}</p>
            <p className="tabular shrink-0 font-medium text-ink">{formatCents(l.cents)}</p>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-ink-faint/80"
                style={{ width: `${Math.max(2, (Math.max(0, l.cents) / escala) * 100)}%` }}
              />
            </div>
            {l.notas.length > 0 ? (
              <span className="shrink-0 text-legenda text-ink-faint">{l.notas.join(" · ")}</span>
            ) : null}
          </div>
        </div>
      );
    case "parte":
      return (
        <div>
          <div className="flex items-baseline justify-between gap-2 text-legenda">
            <p className="min-w-0 text-ink">{l.titulo}</p>
            <p className="tabular shrink-0 text-ink">
              {l.cents !== null ? <span className="font-medium">{formatCentsCompact(l.cents)}</span> : null}
              <span className="ml-1.5 text-ink-muted">{l.pct}%</span>
            </p>
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"
            role="img"
            aria-label={`${l.titulo}: ${l.pct}%`}
          >
            <div className="h-full rounded-full bg-ink-faint/80" style={{ width: `${Math.min(100, l.pct)}%` }} />
          </div>
          {l.notas.length > 0 ? <p className="mt-1 text-legenda text-ink-faint">{l.notas.join(" · ")}</p> : null}
        </div>
      );
    case "texto":
      return (
        <div className="text-legenda">
          <p className="font-medium text-ink">{l.titulo}</p>
          <ul className="mt-0.5 space-y-0.5 text-ink-muted">
            {l.linhas.map((linha, i) => {
              // "LEROY MERLIN R$ 4.772,20/mês · última em 2026-11": nome a esquerda, valor a direita.
              const partes = linha.match(/^(.+?)\s+([+\-−]?R\$\s?[\d.,]+.*)$/);
              return partes ? (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0">{partes[1]}</span>
                  <span className="tabular ml-auto text-right text-ink">{partes[2]}</span>
                </li>
              ) : (
                <li key={i} className="tabular">
                  {linha}
                </li>
              );
            })}
          </ul>
        </div>
      );
  }
}
