import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CircleAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { getActiveHouse } from "@/lib/houses";
import {
  listBudgets,
  listCategories,
  listRecurrences,
  listTransactions,
} from "@/data/queries";
import { buildInsights, historyDepth } from "@/domain/insights";
import { reconcileRecurrences } from "@/domain/forecast";
import { addMonths, currentMonth, isMonthKey, monthLabel } from "@/domain/month";
import { Card, CardHeader } from "@/components/ui/card";
import { MonthSwitcher } from "@/components/month-switcher";
import { cn } from "@/lib/utils";
import type { Insight, InsightTone } from "@/domain/insights";

export const metadata: Metadata = { title: "Insights · Fluxo" };

const TONE: Record<
  InsightTone,
  { border: string; icon: string; Icon: typeof TrendingUp }
> = {
  positive: {
    border: "border-l-positive",
    icon: "text-positive",
    Icon: TrendingDown,
  },
  neutral: { border: "border-l-line-strong", icon: "text-ink-muted", Icon: Sparkles },
  attention: {
    border: "border-l-attention",
    icon: "text-attention",
    Icon: TrendingUp,
  },
  danger: { border: "border-l-danger", icon: "text-danger", Icon: CircleAlert },
};

function InsightCard({ insight }: { insight: Insight }) {
  const tone = TONE[insight.tone];
  const body = (
    <>
      <div className="flex items-start gap-2.5">
        <tone.Icon className={cn("mt-0.5 size-4 shrink-0", tone.icon)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{insight.title}</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">{insight.detail}</p>
        </div>
        {insight.href ? (
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
        ) : null}
      </div>

      {/*
        A evidência é o ponto do insight, não um detalhe opcional: a secao 14
        proíbe mostrar a conclusão sem os números que a sustentam.
      */}
      <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2">
        {insight.evidence.map((e) => (
          <div key={e.label} className="flex items-baseline gap-1.5">
            <dt className="text-[12px] text-ink-faint">{e.label}:</dt>
            <dd className="tabular text-[12px] font-medium text-ink-muted">
              {e.value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );

  const className = cn(
    "block rounded-[--radius-control] border-l-2 bg-surface-2 px-3 py-3 text-left",
    tone.border,
    insight.href && "transition-colors hover:bg-surface-3",
  );

  return insight.href ? (
    <li>
      <Link href={insight.href} className={className}>
        {body}
      </Link>
    </li>
  ) : (
    <li className={className}>{body}</li>
  );
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const month =
    params.mes && isMonthKey(params.mes) ? params.mes : currentMonth();

  const [transactions, categories, budgets, recurrences] = await Promise.all([
    listTransactions(active.id, {
      fromMonth: addMonths(month, -6),
      toMonth: month,
      limit: 3000,
    }),
    listCategories(active.id),
    listBudgets(active.id, month),
    listRecurrences(active.id),
  ]);

  const recurrenceMatches = reconcileRecurrences(
    recurrences,
    transactions,
    month,
  );
  const insights = buildInsights({
    month,
    transactions,
    categories,
    budgets,
    recurrenceMatches,
  });
  const depth = historyDepth(transactions);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} />
      </header>

      <Card>
        <CardHeader
          title={`O que mudou em ${monthLabel(month)}`}
          description="Cada observação vem com os números que a sustentam."
        />

        {insights.length > 0 ? (
          <ul className="space-y-2">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </ul>
        ) : (
          <div className="py-6 text-center">
            <Sparkles className="mx-auto size-6 text-ink-faint" aria-hidden />
            <p className="mt-3 text-sm text-ink">
              {depth < 2
                ? "Ainda não dá para comparar."
                : "Nada fora do comum neste mês."}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-faint">
              {depth < 2
                ? `Há ${depth} ${depth === 1 ? "mês" : "meses"} de histórico. Comparar com um mês só produziria alarme falso, então o app prefere ficar calado até ter base.`
                : "Os gastos ficaram dentro do padrão dos meses anteriores, e nenhum orçamento passou de 80%."}
            </p>
          </div>
        )}
      </Card>

      {insights.length > 0 ? (
        <p className="px-1 text-[12px] text-ink-faint">
          Comparações usam até 6 meses de histórico. Variações abaixo de R$ 50
          não geram observação — seriam ruído, não informação.
        </p>
      ) : null}
    </div>
  );
}
