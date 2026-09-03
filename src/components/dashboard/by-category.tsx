import { listCategories, listTransactions } from "@/data/queries";
import { totalsByCategory } from "@/domain/finance";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/states";
import { CategoryDonut, type DonutSlice } from "./category-donut";
import type { MonthKey } from "@/domain/types";

interface Props {
  houseId: string;
  month: MonthKey;
  memberId: string | null;
  cardId: string | null;
}

export function ByCategorySkeleton() {
  return (
    <Card>
      <CardHeader title="Para onde foi" />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <Skeleton className="mx-auto size-44 rounded-full" />
        <div className="flex-1 space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </Card>
  );
}

export async function ByCategory({ houseId, month, memberId, cardId }: Props) {
  const [transactions, categories] = await Promise.all([
    listTransactions(houseId, { month }),
    listCategories(houseId),
  ]);

  const totals = totalsByCategory(transactions, month, { memberId, cardId });
  const byId = new Map(categories.map((c) => [c.id, c]));

  // Estornos podem deixar uma categoria com total negativo; ela continua na
  // lista (é informação real) mas não vira fatia da rosca, que não representa
  // valor negativo.
  const positives = totals.filter((t) => t.totalCents > 0);
  const visibleTotal = positives.reduce((sum, t) => sum + t.totalCents, 0);

  const slices: DonutSlice[] = positives.slice(0, 8).map((t) => ({
    name: t.categoryId ? (byId.get(t.categoryId)?.name ?? "Sem categoria") : "Sem categoria",
    value: t.totalCents,
    color: t.categoryId ? (byId.get(t.categoryId)?.color ?? "#8B8B94") : "#8B8B94",
  }));

  return (
    <Card>
      <CardHeader
        title="Para onde foi"
        description={
          totals.length > 0
            ? `${totals.length} categoria(s) neste mês.`
            : undefined
        }
      />

      {totals.length === 0 ? (
        <EmptyState
          title="Nada registrado neste mês"
          description="Adicione um lançamento ou importe uma fatura para ver a distribuição."
        />
      ) : (
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <CategoryDonut
            slices={slices}
            centerLabel="Total"
            centerValue={visibleTotal}
          />

          <ul className="min-w-0 flex-1 space-y-1">
            {totals.map((t) => {
              const category = t.categoryId ? byId.get(t.categoryId) : undefined;
              return (
                <li
                  key={t.categoryId ?? "sem-categoria"}
                  className="flex items-center gap-2.5 rounded-[--radius-control] px-2 py-2 hover:bg-surface-2"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: category?.color ?? "#8B8B94" }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {category?.name ?? "Sem categoria"}
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-faint">
                    {Math.round(t.share * 100)}%
                  </span>
                  <span className="tabular shrink-0 text-sm font-medium text-ink">
                    {formatCents(t.totalCents)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
