import { formatCents } from "@/lib/money";

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

/**
 * Rosca da distribuição por categoria, em SVG puro.
 *
 * Decisão consciente de não usar Recharts aqui. A biblioteca está no projeto
 * (a especificação pede) e vai ganhar o mapa de fluxo e as séries temporais
 * da Etapa 5, onde eixos, escala e tooltip valem o peso. Para uma rosca
 * estática ela custava ~95 kB no bundle de /inicio - mais do que todo o
 * resto da página somado - para desenhar arcos que o SVG faz com
 * `stroke-dasharray`.
 *
 * Como não há interação, o componente roda no servidor: zero JavaScript
 * enviado ao cliente.
 *
 * O gráfico é `aria-hidden` porque a lista ao lado já traz nome, valor e
 * percentual em texto — que é o que o leitor de tela deve ler.
 */
export function CategoryDonut({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: number;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (slices.length === 0 || total <= 0) return null;

  const RADIUS = 42;
  const STROKE = 14;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const GAP = 1.5; // respiro entre fatias, em unidades do viewBox

  let offset = 0;
  const arcs = slices.map((slice) => {
    const length = (slice.value / total) * CIRCUMFERENCE;
    const arc = {
      key: slice.name,
      color: slice.color,
      // Uma fatia menor que o respiro viraria um traço invisível: mantemos
      // um mínimo para ela não sumir do gráfico.
      dash: Math.max(length - GAP, 0.5),
      offset,
    };
    offset += length;
    return arc;
  });

  return (
    <div className="relative mx-auto size-44 shrink-0" aria-hidden>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={arc.color}
            strokeWidth={STROKE}
            strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
            strokeDashoffset={-arc.offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">
          {centerLabel}
        </span>
        <span className="tabular mt-0.5 text-[15px] font-semibold text-ink">
          {formatCents(centerValue)}
        </span>
      </div>
    </div>
  );
}
