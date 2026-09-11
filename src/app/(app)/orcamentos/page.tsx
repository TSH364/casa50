import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getActiveHouse } from "@/lib/houses";
import { houseView } from "@/lib/house-view";
import { TotalsNote } from "@/components/totals-note";
import { listBudgets, listCategories, listTransactions } from "@/data/queries";
import { budgetProgress, suggestBudget, totalsByCategory } from "@/domain/finance";
import { addMonths, currentMonth, isMonthKey, monthRange } from "@/domain/month";
import { toCents } from "@/lib/money";
import { MonthSwitcher } from "@/components/month-switcher";
import { BudgetsManager } from "@/components/budgets/budgets-manager";
import { RebalancePanel } from "@/components/budgets/rebalance-panel";
import type { BudgetRow } from "@/components/budgets/budgets-manager";

export const metadata: Metadata = { title: "Orçamentos · Fluxo" };

export default async function OrcamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; totais?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const month =
    params.mes && isMonthKey(params.mes) ? params.mes : currentMonth();

  // Três meses anteriores alimentam a sugestão de limite (secao 12).
  const historyFrom = addMonths(month, -3);

  const view = await houseView(active.id, params.totais);
  const excludeCategoryIds = view.excludeCategoryIds;

  const [categories, budgets, monthTransactions, history] = await Promise.all([
    Promise.resolve(view.categories),
    listBudgets(active.id, month),
    listTransactions(active.id, { month, excludeCategoryIds }),
    listTransactions(active.id, {
      fromMonth: historyFrom,
      toMonth: addMonths(month, -1),
      excludeCategoryIds,
      limit: 2000,
    }),
  ]);

  const spentByCategory = new Map(
    totalsByCategory(monthTransactions, month).map((t) => [t.categoryId, t.totalCents]),
  );
  const limitByCategory = new Map(
    budgets.map((b) => [b.categoryId, toCents(b.limitAmount)]),
  );

  // Para a sugestão: total por categoria em cada mês anterior, separadamente.
  const pastMonths = monthRange(historyFrom, addMonths(month, -1));
  const historyByCategory = new Map<string, number[]>();
  for (const past of pastMonths) {
    const totals = totalsByCategory(history, past);
    for (const total of totals) {
      if (total.categoryId === null) continue;
      const list = historyByCategory.get(total.categoryId) ?? [];
      list.push(total.totalCents);
      historyByCategory.set(total.categoryId, list);
    }
  }

  // Só categorias de primeiro nível recebem orçamento: limitar pai e filha ao
  // mesmo tempo criaria dois números concorrentes para o mesmo gasto.
  const rows: BudgetRow[] = categories
    .filter((c) => c.parentId === null)
    .map((category) => {
      const limitCents = limitByCategory.get(category.id) ?? 0;
      const spentCents = spentByCategory.get(category.id) ?? 0;
      return {
        category,
        limitCents,
        spentCents,
        progress:
          limitCents > 0
            ? budgetProgress(spentCents, limitCents, month)
            : null,
        suggestionCents: suggestBudget(historyByCategory.get(category.id) ?? []),
      };
    })
    .sort((a, b) => b.spentCents - a.spentCents);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} />
      </header>

      <TotalsNote view={view} month={month} />

      {/* Sem fallback visível: quando não há pressão na agenda o painel não
          existe, e um esqueleto que some sozinho prometeria conteúdo. */}
      <Suspense fallback={null}>
        <RebalancePanel
          houseId={active.id}
          month={month}
          categories={categories}
          excludeCategoryIds={excludeCategoryIds}
        />
      </Suspense>

      <BudgetsManager rows={rows} month={month} />
    </div>
  );
}
