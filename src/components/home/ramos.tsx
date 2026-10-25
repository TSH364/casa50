import { Circle, icons, type LucideIcon } from "lucide-react";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { tintaSobre, type Ramo } from "@/domain/home";

const LINHA = 58;
/**
 * Largura do desenho da esquerda (circulo + ramos). Era 150 com o grafico
 * solto na pagina; dentro do cartao, 120 devolve aos nomes a largura que o
 * padding do cartao tirou.
 */
const ESQ = 120;

/** "heart-pulse" -> o icone HeartPulse do lucide. */
function iconeDe(nome: string | null): LucideIcon {
  if (!nome) return Circle;
  const pascal = nome.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
  return (icons as Record<string, LucideIcon>)[pascal] ?? Circle;
}

/**
 * Para onde foi, em ramos: o total do mes no centro, as categorias saindo
 * dele. O comprimento de cada faixa acompanha a parte do total (a maior chega
 * a ponta); a cor e a da categoria, a mesma de todo o app, lisa. Fica dentro
 * do cartao da secao, entao os circulos se separam pela borda, nao por sombra.
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
        <svg width={ESQ} height={altura} viewBox={`0 0 ${ESQ} ${altura}`} className="absolute left-0 top-0 text-line-strong">
          <path
            d={`M48 ${meio - 60} A60 60 0 0 1 48 ${meio + 60}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="48" cy={meio - 60} r="3" fill="currentColor" />
          <circle cx="48" cy={meio + 60} r="3" fill="currentColor" />
          {centros.map((y, i) => {
            const y0 = meio + (i - (ramos.length - 1) / 2) * 8;
            return (
              <g key={i}>
                <path d={`M105 ${y0} C118 ${y0} 112 ${y} ${ESQ} ${y}`} fill="none" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="105" cy={y0} r="2.2" fill="currentColor" />
              </g>
            );
          })}
        </svg>

        <div
          className="absolute left-0 flex size-24 flex-col items-center justify-center rounded-full border border-line-strong bg-surface-2"
          style={{ top: meio - 48 }}
        >
          <span className="text-legenda text-ink-faint">{mes}</span>
          <span className="tabular text-destaque font-bold text-ink">{formatCentsCompact(totalCents)}</span>
        </div>

        {ramos.map((r, i) => {
          const Icone = iconeDe(r.icone);
          return (
            <div key={r.nome} className="absolute right-0 h-11" style={{ left: ESQ, top: 12 + i * LINHA }}>
              <div className="absolute left-[52px] right-0 top-0 flex items-baseline justify-between gap-2 leading-[18px]">
                <span className="truncate text-corpo font-semibold text-ink">{r.nome}</span>
                <span className="tabular shrink-0 text-legenda text-ink-faint">{formatCentsCompact(r.cents)}</span>
              </div>
              <div
                className="tabular absolute left-[22px] top-[21px] flex h-[22px] items-center justify-end rounded-r-full pr-2.5 text-legenda font-bold"
                style={{
                  // Minimo de 44px: a porcentagem cabe ate na menor faixa.
                  width: `max(44px, calc((100% - 22px) * ${r.largura}))`,
                  background: r.cor,
                  color: tintaSobre(r.cor),
                }}
              >
                {Math.round(r.parte * 100)}%
              </div>
              <div
                className="absolute left-0 top-0 flex size-11 items-center justify-center rounded-full border border-line bg-surface-2"
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
