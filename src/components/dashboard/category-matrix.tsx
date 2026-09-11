import { listCategories, listTransactions } from "@/data/queries";
import { categoryMatrix, type CellTone } from "@/domain/finance";
import { addMonths, monthLabel, monthRange, monthShortLabel } from "@/domain/month";
import { formatCents } from "@/lib/money";
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
  }));

  if (columns.length === 0) {
    return (
      <Card>
        <CardHeader title="Mês a mês, por categoria" />
        <p className="py-6 text-center text-[13px] text-ink-faint">
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
            ? "A cor compara cada mês com o usual da própria categoria."
            : `Com ${matrix.monthsWithData} ${matrix.monthsWithData === 1 ? "mês" : "meses"} de histórico ainda não dá para dizer o que é usual — por ora, só os valores.`
        }
      />

      {/*
        Rola na horizontal com a coluna do mês fixa: são muitas categorias e
        uma tela estreita, e perder de vista a que mês a linha pertence
        tornaria a tabela ilegível na primeira rolagem.
      */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-max border-separate border-spacing-0.5 text-[12px]">
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
                  <span className="tabular mt-0.5 block text-[11px] text-ink-faint">
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
                  <span className="tabular block text-[11px] text-ink-faint">
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
                        "tabular rounded-[--radius-control] px-1.5 py-2 text-right",
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

      {podeComparar ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-[12px] text-ink-faint">
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

      <p className="mt-2 text-[12px] text-ink-faint">
        Valores em reais, sem centavos. A comparação é dentro da coluna, contra
        a mediana da própria categoria — nunca entre categorias.
      </p>
    </Card>
  );
}
