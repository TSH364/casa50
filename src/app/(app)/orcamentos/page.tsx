import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse } from "@/lib/houses";
import { listBudgets, listCategories, listTransactions } from "@/data/queries";
import { budgetProgress, suggestBudget, totalsByCategory } from "@/domain/finance";
import { addMonths, currentMonth, isMonthKey, monthRange } from "@/domain/month";
import { toCents } from "@/lib/money";
import { MonthSwitcher } from "@/components/month-switcher";
import { BudgetsManager } from "@/components/budgets/budgets-manager";
import type { BudgetRow } from "@/components/budgets/budgets-manager";

export const metadata: Metadata = { title: "Orçamentos · Fluxo" };

export default async function OrcamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const month =
    params.mes && isMonthKey(params.mes) ? params.mes : currentMonth();

  // Três meses anteriores alimentam a sugestão de limite (secao 12).
  const historyFrom = addMonths(month, -3);

  const [categories, budgets, monthTransactions, history] = await Promise.all([
    listCategories(active.id),
    listBudgets(active.id, month),
    listTransactions(active.id, { month }),
    listTransactions(active.id, {
      fromMonth: historyFrom,
      toMonth: addMonths(month, -1),
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

      <BudgetsManager rows={rows} month={month} />
    </div>
  );
}
