import { tintaSobre } from "@/domain/home";

export interface BarraItem {
  id: string;
  nome: string;
  /** 0 a 1; passa de 1 quando estourou. */
  razao: number;
  detalhe: string;
  /** Cor da barra: a da categoria (hexadecimal), ou um token para metas. */
  cor: string;
  /** A tinta da porcentagem; sem ela, a que der mais contraste com `cor`. */
  tinta?: string;
  /** Linha de situacao embaixo, quando ha. */
  situacao?: { texto: string; tom: "danger" | "attention" | "positive" } | null;
}

const TOM = {
  danger: "text-danger",
  attention: "text-attention",
  positive: "text-positive",
} as const;

/**
 * Barra grossa com a porcentagem dentro: metas e orcamentos. A cor diz a
 * categoria; a situacao ("Perto do limite", "Meta alcancada") vem escrita.
 * Cor lisa, sem degrade nem sombra (DESIGN_SYSTEM.md).
 */
export function Barras({ itens }: { itens: BarraItem[] }) {
  return (
    <ul className="space-y-4">
      {itens.map((b) => {
        const pct = Math.round(b.razao * 100);
        const largura = Math.max(0.14, Math.min(1, b.razao));
        return (
          <li key={b.id} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-corpo font-semibold text-ink">{b.nome}</span>
              <span className="tabular shrink-0 text-legenda text-ink-faint">{b.detalhe}</span>
            </div>
            <div
              className="h-8 rounded-full bg-surface-3"
              role="progressbar"
              aria-label={b.nome}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, pct)}
              aria-valuetext={`${pct}%`}
            >
              <div
                className="tabular flex h-8 items-center rounded-full pl-3.5 text-corpo font-bold"
                style={{
                  width: `${largura * 100}%`,
                  background: b.cor,
                  color: b.tinta ?? tintaSobre(b.cor),
                }}
              >
                {pct}%
              </div>
            </div>
            {b.situacao ? (
              <p className={`text-legenda font-semibold ${TOM[b.situacao.tom]}`}>{b.situacao.texto}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
