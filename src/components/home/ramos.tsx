import { Circle, icons, type LucideIcon } from "lucide-react";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { escurecer, tintaSobre, type Ramo } from "@/domain/home";

const LINHA = 58;

/** "heart-pulse" -> o icone HeartPulse do lucide. */
function iconeDe(nome: string | null): LucideIcon {
  if (!nome) return Circle;
  const pascal = nome.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
  return (icons as Record<string, LucideIcon>)[pascal] ?? Circle;
}

/**
 * Para onde foi, em ramos: o total do mes no centro, as categorias saindo
 * dele. O comprimento de cada faixa acompanha a parte do total (a maior chega
 * a ponta); a cor e a da categoria, a mesma de todo o app.
 */
export function Ramos({
  ramos,
  totalCents,
  mes,
}: {
  ramos: (Ramo & { icone: string | null })[];
  totalCents: number;
  /** "Setembro". */
  mes: string;
}) {
  const altura = 10 + ramos.length * LINHA;
  const meio = altura / 2;
  const centros = ramos.map((_, i) => 34 + i * LINHA);

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {`Gasto de ${mes}: ${formatCents(totalCents)}. `}
        {ramos.map((r) => `${r.nome}, ${formatCents(r.cents)} (${Math.round(r.parte * 100)}%)`).join("; ")}.
      </figcaption>
      <div className="relative" style={{ height: altura }} aria-hidden>
        <svg width="150" height={altura} viewBox={`0 0 150 ${altura}`} className="absolute left-0 top-0 text-line-strong">
          <path
            d={`M50 ${meio - 66} A66 66 0 0 1 50 ${meio + 66}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="50" cy={meio - 66} r="3" fill="currentColor" />
          <circle cx="50" cy={meio + 66} r="3" fill="currentColor" />
          {centros.map((y, i) => {
            const y0 = meio + (i - (ramos.length - 1) / 2) * 8;
            return (
              <g key={i}>
                <path d={`M113 ${y0} C134 ${y0} 128 ${y} 150 ${y}`} fill="none" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="113" cy={y0} r="2.2" fill="currentColor" />
              </g>
            );
          })}
        </svg>

        <div
          className="absolute left-0 flex size-[104px] flex-col items-center justify-center rounded-full border-[5px] border-surface-2 bg-surface shadow-[0_6px_18px_rgba(20,23,40,0.12)]"
          style={{ top: meio - 52 }}
        >
          <span className="text-legenda text-ink-faint">{mes}</span>
          <span className="tabular text-destaque font-bold text-ink">{formatCentsCompact(totalCents)}</span>
        </div>

        {ramos.map((r, i) => {
          const Icone = iconeDe(r.icone);
          return (
            <div key={r.nome} className="absolute left-[150px] right-0 h-11" style={{ top: 12 + i * LINHA }}>
              <div className="absolute left-[52px] right-0 top-0 flex items-baseline justify-between gap-2 leading-[18px]">
                <span className="truncate text-corpo font-bold text-ink">{r.nome}</span>
                <span className="tabular shrink-0 text-legenda text-ink-faint">{formatCentsCompact(r.cents)}</span>
              </div>
              <div
                className="tabular absolute left-[22px] top-[21px] flex h-[22px] items-center justify-end rounded-r-full pr-2.5 text-legenda font-bold"
                style={{
                  width: `calc((100% - 22px) * ${r.largura})`,
                  background: `linear-gradient(90deg, ${escurecer(r.cor)}, ${r.cor})`,
                  color: tintaSobre(r.cor),
                }}
              >
                {Math.round(r.parte * 100)}%
              </div>
              <div
                className="absolute left-0 top-0 flex size-11 items-center justify-center rounded-full border-[3px] border-canvas bg-surface-3 shadow-[0_6px_18px_rgba(20,23,40,0.12)]"
                style={{ color: r.cor }}
              >
                <Icone className="size-[18px]" aria-hidden />
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
