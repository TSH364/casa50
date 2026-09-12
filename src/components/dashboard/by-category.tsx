import { listCategories, listTransactions } from "@/data/queries";
import { itemsByCategory, totalsByCategory } from "@/domain/finance";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/states";
import { CategoryDonut, type DonutSlice } from "./category-donut";
import { CategoryRows, type CategoryRow } from "./category-rows";
import type { MonthKey } from "@/domain/types";

interface Props {
  houseId: string;
  month: MonthKey;
  memberId: string | null;
  cardId: string | null;
  /** Categorias fora dos totais da casa. Vem de `houseView`. */
  excludeCategoryIds: string[];
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

export async function ByCategory({
  houseId,
  month,
  memberId,
  cardId,
  excludeCategoryIds,
}: Props) {
  const [transactions, categories] = await Promise.all([
    listTransactions(houseId, { month, excludeCategoryIds }),
    listCategories(houseId),
  ]);

  const totals = totalsByCategory(transactions, month, { memberId, cardId });
  const items = itemsByCategory(transactions, month, { memberId, cardId });
  const byId = new Map(categories.map((c) => [c.id, c]));

  const rows: CategoryRow[] = totals.map((t) => ({
    categoryId: t.categoryId,
    name: t.categoryId
      ? (byId.get(t.categoryId)?.name ?? "Sem categoria")
      : "Sem categoria",
    color: (t.categoryId ? byId.get(t.categoryId)?.color : null) ?? "#8B8B94",
    totalCents: t.totalCents,
    share: t.share,
    count: t.count,
    items: items.get(t.categoryId) ?? [],
  }));

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

          <CategoryRows rows={rows} month={month} />
        </div>
      )}
    </Card>
  );
}
