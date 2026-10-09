import { listCategories, listTransactions } from "@/data/queries";
import { categoryMatrix, type CellTone } from "@/domain/finance";
import { addMonths, monthLabel, monthRange, monthShortLabel } from "@/domain/month";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { cn } from "@/lib/utils";
import type { MonthKey } from "@/domain/types";

/** Quantos meses a matriz olha para tras. */
const WINDOW = 6;

export function CategoryMatrixSkeleton() {
  return (
    <Card>
      <CardHeader title="Mês a mês, por categoria" />
      <Skeleton className="h-64 w-full" />
    </Card>
  );
}

/**
 * Reais inteiros, sem "R$" e sem centavos.
 *
 * A coluna inteira é dinheiro, então repetir o símbolo em cada célula gasta
 * largura sem informar; e centavos numa matriz de leitura rápida só poluem. O
 * valor exato fica no `title` de cada célula.
 */
const COMPACT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/**
 * Marca não-colorida do tom.
 *
 * A cor sozinha não pode carregar significado: quem não distingue os dois
 * matizes precisa de outro sinal, e a seta é ele.
 */
const GLYPH: Record<CellTone, string> = {
  above: "▲",
  below: "▼",
  typical: "",
  empty: "",
};

const BACKGROUND: Record<CellTone, string> = {
  above: "var(--color-cell-above)",
  below: "var(--color-cell-below)",
  typical: "var(--color-cell-typical)",
  empty: "transparent",
};

const TONE_TEXT: Record<CellTone, string> = {
  above: "acima do usual nesta categoria",
  below: "abaixo do usual nesta categoria",
  typical: "dentro do usual nesta categoria",
  empty: "sem gasto",
};

/**
 * Gasto por mês e por categoria, em matriz (secao 7).
 *
 * A rosca do Início responde "para onde foi o dinheiro ESTE mês". A matriz
 * responde a pergunta que um mês só não alcança: "isto é normal para nós?".
 * Por isso a cor compara cada célula com a mediana da PRÓPRIA coluna, nunca
 * entre colunas - mercado e assinatura têm ordens de grandeza diferentes, e
 * pintar pela grandeza faria a maior parecer sempre um problema.
 */
export async function CategoryMatrix({
  houseId,
  month,
  excludeCategoryIds,
}: {
  houseId: string;
  month: MonthKey;
  /** Categorias fora dos totais da casa. Vem de `houseView`. */
  excludeCategoryIds: string[];
}) {
  const from = addMonths(month, -(WINDOW - 1));
  const [transactions, categories] = await Promise.all([
    listTransactions(houseId, {
      fromMonth: from,
      toMonth: month,
      excludeCategoryIds,
      limit: 3000,
    }),
    listCategories(houseId),
  ]);

  const months = monthRange(from, month);
  const matrix = categoryMatrix(transactions, months);
  const byId = new Map(categories.map((c) => [c.id, c]));

  const columns = matrix.categoryIds.map((id, i) => ({
    id,
    name: id ? (byId.get(id)?.name ?? "Categoria") : "Sem categoria",
    color: (id ? byId.get(id)?.color : null) ?? "#8B8B94",
    totalCents: matrix.categoryTotals[i] ?? 0,
    medianCents: matrix.categoryMedians[i] ?? 0,
  }));

  if (columns.length === 0) {
    return (
      <Card>
        <CardHeader title="Mês a mês, por categoria" />
        <p className="py-6 text-center text-corpo text-ink-faint">
          Nenhum gasto nos últimos {WINDOW} meses.
        </p>
      </Card>
    );
  }

  // Linhas sem movimento nenhum viram ruído: seis linhas vazias empurram a
  // única com dado para fora da tela.
  const rows = matrix.rows.filter((r) => r.totalCents !== 0);
  const podeComparar = matrix.monthsWithData >= 3;

  return (
    <Card>
      <CardHeader
        title="Mês a mês, por categoria"
        description={
          podeComparar
            ? "Cada categoria nos últimos 6 meses. O tracejado é o usual dela; o mês em cor saiu dele."
            : `Com ${matrix.monthsWithData} ${matrix.monthsWithData === 1 ? "mês" : "meses"} de histórico ainda não dá para dizer o que é usual — por ora, só os valores.`
        }
      />

      <Faixas
        columns={columns}
        rows={matrix.rows}
        month={month}
        podeComparar={podeComparar}
      />

      {/* A tabela continua aqui, para conferir valor a valor. */}
      <details className="mt-3 border-t border-line pt-2.5">
        <summary className="cursor-pointer text-corpo font-medium text-ink-muted">Ver a tabela mês a mês</summary>
        <div className="mt-2">
          {/*
            Rola na horizontal com a coluna do mês fixa: são muitas categorias e
            uma tela estreita, e perder de vista a que mês a linha pertence
            tornaria a tabela ilegível na primeira rolagem.
          */}
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-max border-separate border-spacing-0.5 text-legenda">
              <caption className="sr-only">
                Gasto por mês e por categoria nos últimos {WINDOW} meses.
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-surface px-2 pb-1 text-left font-medium text-ink-faint"
                  >
                    Mês
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.id ?? "sem"}
                      scope="col"
                      className="min-w-[88px] max-w-[88px] px-1 pb-1 text-left align-bottom font-normal"
                    >
                      <span className="flex items-start gap-1">
                        <span
                          className="mt-1 size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: c.color }}
                          aria-hidden
                        />
                        <span className="break-words leading-tight text-ink-muted">{c.name}</span>
                      </span>
                      <span className="tabular mt-0.5 block text-legenda text-ink-faint">
                        {COMPACT.format(c.totalCents / 100)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
    
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 whitespace-nowrap bg-surface px-2 py-1 text-left font-normal"
                    >
                      <span className="block capitalize text-ink">
                        {monthShortLabel(row.month)}
                        <span className="text-ink-faint"> {row.month.slice(2, 4)}</span>
                      </span>
                      <span className="tabular block text-legenda text-ink-faint">
                        {COMPACT.format(row.totalCents / 100)}
                      </span>
                    </th>
    
                    {row.cells.map((cell, i) => {
                      const column = columns[i]!;
                      return (
                        <td
                          key={column.id ?? "sem"}
                          title={`${column.name} · ${monthLabel(row.month)} · ${formatCents(cell.totalCents)} — ${TONE_TEXT[cell.tone]}`}
                          style={{ backgroundColor: BACKGROUND[cell.tone] }}
                          className={cn(
                            "tabular rounded-(--radius-control) px-1.5 py-2 text-right",
                            cell.tone === "empty" ? "text-ink-faint" : "text-ink",
                          )}
                        >
                          {cell.tone === "empty" ? (
                            <span aria-label="sem gasto">—</span>
                          ) : (
                            <>
                              {GLYPH[cell.tone] ? (
                                <span className="mr-0.5 text-[9px]" aria-hidden>
                                  {GLYPH[cell.tone]}
                                </span>
                              ) : null}
                              {COMPACT.format(cell.totalCents / 100)}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      {podeComparar ? (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-legenda text-ink-faint">
            {(
              [
                ["above", "acima do usual"],
                ["typical", "dentro do usual"],
                ["below", "abaixo do usual"],
              ] as const
            ).map(([tone, label]) => (
              <li key={tone} className="flex items-center gap-1.5">
                <span
                  className="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-[8px] text-ink"
                  style={{ backgroundColor: BACKGROUND[tone] }}
                  aria-hidden
                >
                  {GLYPH[tone]}
                </span>
                {label}
              </li>
            ))}
          </ul>
        ) : null}
  
        <p className="mt-2 text-legenda text-ink-faint">
          Valores em reais, sem centavos. A comparação é dentro da coluna, contra
          a mediana da própria categoria — nunca entre categorias.
        </p>
      </details>
    </Card>
  );
}

type Coluna = { id: string | null; name: string; color: string; totalCents: number; medianCents: number };

const BARRA_ATUAL: Record<CellTone, string> = {
  above: "bg-attention",
  below: "bg-positive",
  typical: "bg-ink-muted",
  empty: "bg-line",
};

const TOM_TEXTO: Record<CellTone, { texto: string; className: string }> = {
  above: { texto: "▲ acima", className: "text-attention" },
  below: { texto: "▼ abaixo", className: "text-positive" },
  typical: { texto: "no usual", className: "text-ink-faint" },
  empty: { texto: "sem gasto", className: "text-ink-faint" },
};

/**
 * Uma linha por categoria: seis barrinhas dos meses, a do mes em foco com a
 * cor do que ele foi (acima, abaixo, no usual), e uma linha tracejada no
 * usual (a mediana). Cada linha tem a propria escala - comparar mercado com
 * assinatura pela altura seria o mesmo erro que a cor da tabela evita.
 *
 * Era so a tabela: no celular cabiam duas categorias e meia, e o resto
 * ficava atras de uma rolagem de lado. Em linhas, todas cabem na tela.
 */
function Faixas({
  columns,
  rows,
  month,
  podeComparar,
}: {
  columns: Coluna[];
  rows: { month: MonthKey; cells: { totalCents: number; tone: CellTone }[] }[];
  month: MonthKey;
  podeComparar: boolean;
}) {
  const meses = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  return (
    <div>
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto_5.75rem] items-end gap-x-3 border-b border-line pb-1.5 text-[10px] text-ink-faint"
        aria-hidden
      >
        <span>Categoria</span>
        <span className="flex gap-[3px]">
          {meses.map((r) => (
            <span key={r.month} className={cn("w-2.5 text-center", r.month === month && "font-semibold text-ink-muted")}>
              {monthShortLabel(r.month).slice(0, 1)}
            </span>
          ))}
        </span>
        <span className="text-right capitalize">{monthShortLabel(month)}</span>
      </div>
      <ul className="divide-y divide-line">
        {columns.map((c, i) => {
          const serie = meses.map((r) => ({ month: r.month, ...r.cells[i]! }));
          const atual = serie.find((s) => s.month === month) ?? { totalCents: 0, tone: "empty" as CellTone };
          const max = Math.max(1, c.medianCents, ...serie.map((s) => s.totalCents));
          const tom = podeComparar ? atual.tone : atual.tone === "empty" ? "empty" : "typical";
          return (
            <li key={c.id ?? "sem"} className="grid grid-cols-[minmax(0,1fr)_auto_5.75rem] items-center gap-x-3 py-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-corpo text-ink">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                  <span className="truncate">{c.name}</span>
                </p>
                {podeComparar && c.medianCents > 0 ? (
                  <p className="tabular pl-3.5 text-legenda text-ink-faint">usual {formatCentsCompact(c.medianCents)}</p>
                ) : null}
              </div>

              <div
                className="relative flex h-7 items-end gap-[3px]"
                role="img"
                aria-label={`${c.name}: ${serie
                  .map((s) => `${monthShortLabel(s.month)} ${formatCentsCompact(s.totalCents)}`)
                  .join(", ")}`}
              >
                {serie.map((s) => (
                  <span
                    key={s.month}
                    title={`${monthLabel(s.month)} · ${formatCents(s.totalCents)}`}
                    className={cn(
                      "w-2.5 rounded-t-[3px]",
                      s.month === month ? BARRA_ATUAL[tom] : s.totalCents > 0 ? "bg-ink-faint/45" : "bg-line",
                    )}
                    style={{ height: s.totalCents > 0 ? `${Math.max(6, (s.totalCents / max) * 100)}%` : "2px" }}
                  />
                ))}
                {/* O usual por cima das barras: e a regua contra a qual cada mes se le. */}
                {podeComparar && c.medianCents > 0 ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-x-0.5 border-t border-dashed border-ink-muted"
                    style={{ bottom: `${(c.medianCents / max) * 100}%` }}
                  />
                ) : null}
              </div>

              <div className="text-right">
                <p className="tabular text-corpo font-medium text-ink">
                  {atual.totalCents > 0 ? formatCentsCompact(atual.totalCents) : "—"}
                </p>
                {podeComparar ? (
                  <p className={cn("text-legenda", TOM_TEXTO[tom].className)}>{TOM_TEXTO[tom].texto}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
