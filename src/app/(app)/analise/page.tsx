import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { houseView } from "@/lib/house-view";
import { getAiStatus } from "@/lib/ai-config";
import {
  getLatestAiAnalysis,
  listBudgets,
  listCalendarEvents,
  listCards,
  listRecurrences,
  listTransactions,
} from "@/data/queries";
import { buildInsights, historyDepth } from "@/domain/insights";
import {
  detectRecurrences,
  forecastMonths,
  installmentSeries,
  reconcileRecurrences,
} from "@/domain/forecast";
import { monthPressure } from "@/domain/calendar";
import { addMonths, currentMonth, daysInMonth, isMonthKey, monthLabel } from "@/domain/month";
import { Card, CardHeader } from "@/components/ui/card";
import { MonthSwitcher } from "@/components/month-switcher";
import { TotalsNote } from "@/components/totals-note";
import { CategoryMatrix, CategoryMatrixSkeleton } from "@/components/dashboard/category-matrix";
import { AgendaPanel, AgendaPanelSkeleton } from "@/components/calendar/agenda-panel";
import { RecurrencesPanel } from "@/components/forecast/recurrences-panel";
import { InstallmentsCard, NextMonthsCard } from "@/components/forecast/forecast-cards";
import { InsightCard } from "@/components/insights/insight-card";
import { AiAnalysisCard } from "@/components/insights/ai-analysis";

export const metadata: Metadata = { title: "Análise · Fluxo" };

/** A analise com IA leva de 5 a 20 segundos; o padrao da Vercel cortaria antes. */
export const maxDuration = 60;

/**
 * Analise (secoes 8 e 14): o que aconteceu no mes e o que vem pela frente,
 * numa rolagem so.
 *
 * Eram duas telas - Insights e Previsao - que respondiam a mesma pergunta
 * de lados diferentes ("como estamos?"), e a casa pulava de uma para a outra.
 * A ordem segue a leitura: a IA resume, o app mostra o que mudou, a agenda
 * explica o mes, e depois vem o que ja esta comprometido. A matriz fica por
 * ultimo, como o terreno onde conferir tudo.
 */
export default async function AnalisePage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; totais?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const month = params.mes && isMonthKey(params.mes) ? params.mes : currentMonth();
  const view = await houseView(active.id, params.totais);
  const excludeCategoryIds = view.excludeCategoryIds;
  const scope = view.showingAll ? "tudo" : "casa";
  const categories = view.categories;

  const [transactions, budgets, recurrences, cards, members, events, ia, analise] = await Promise.all([
    // Doze meses para trás: a detecção de recorrência precisa de sequência,
    // e as parcelas longas precisam do mês em que começaram.
    listTransactions(active.id, {
      fromMonth: addMonths(month, -12),
      toMonth: month,
      excludeCategoryIds,
      limit: 5000,
    }),
    listBudgets(active.id, month),
    listRecurrences(active.id),
    listCards(active.id),
    listMembers(active.id),
    // Doze meses de agenda: o aprendizado de "quanto custa uma viagem"
    // precisa das viagens do ano.
    listCalendarEvents(active.id, {
      from: `${addMonths(month, -12)}-01`,
      to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
    }),
    getAiStatus(active.id),
    getLatestAiAnalysis(active.id, month, scope),
  ]);

  // ---- o que mudou (insights): seis meses de base, como sempre foi
  const recentes = transactions.filter((t) => t.invoiceMonth >= addMonths(month, -6));
  const matches = reconcileRecurrences(recurrences, transactions, month);
  const pressure =
    events.length > 0
      ? monthPressure(month, events, recentes, { today: new Date().toISOString().slice(0, 10) })
      : undefined;
  const insights = buildInsights({
    month,
    transactions: recentes,
    categories,
    budgets,
    recurrenceMatches: matches,
    pressure,
  });
  const depth = historyDepth(recentes);

  // ---- o que vem (previsao)
  const running = installmentSeries(transactions, month).filter((s) => !s.isFinished);
  const forecast = forecastMonths({ transactions, recurrences, fromMonth: month });
  // Só sugere recorrência que ainda não está cadastrada.
  const known = new Set(
    recurrences.map((r) =>
      (r.merchant ?? r.description).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim(),
    ),
  );
  const candidates = detectRecurrences(transactions).filter((c) => !known.has(c.merchantNormalized));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} />
      </header>

      <TotalsNote view={view} month={month} />

      <AiAnalysisCard
        key={`${month}:${scope}`}
        month={month}
        scope={scope}
        initial={analise}
        enabled={ia.source !== null}
      />

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
              {depth < 2 ? "Ainda não dá para comparar." : "Nada fora do comum neste mês."}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-faint">
              {depth < 2
                ? `Há ${depth} ${depth === 1 ? "mês" : "meses"} de histórico. Comparar com um mês só produziria alarme falso, então o app prefere ficar calado até ter base.`
                : "Os gastos ficaram dentro do padrão dos meses anteriores, e nenhum orçamento passou de 80%."}
            </p>
          </div>
        )}
        {insights.length > 0 ? (
          <p className="mt-3 text-[12px] text-ink-faint">
            Comparações usam até 6 meses de histórico. Variações abaixo de R$ 50 não geram observação — seriam
            ruído, não informação.
          </p>
        ) : null}
      </Card>

      {/* A agenda explica um mês fora do padrão. */}
      <section id="agenda" className="scroll-mt-20">
        <Suspense fallback={<AgendaPanelSkeleton />}>
          <AgendaPanel houseId={active.id} month={month} excludeCategoryIds={excludeCategoryIds} />
        </Suspense>
      </section>

      <section id="proximos-meses" className="scroll-mt-20">
        <NextMonthsCard forecast={forecast} />
      </section>

      <section id="recorrencias" className="scroll-mt-20">
        <RecurrencesPanel
          matches={matches}
          candidates={candidates}
          month={month}
          categories={categories}
          cards={cards}
          members={members}
        />
      </section>

      <section id="parcelas" className="scroll-mt-20">
        <InstallmentsCard running={running} categories={categories} cards={cards} />
      </section>

      {/*
        Os insights dizem o que mudou; a matriz mostra o terreno de onde
        saíram, para o casal conferir a conclusão em vez de acreditar nela.
      */}
      <Suspense key={`matriz:${month}`} fallback={<CategoryMatrixSkeleton />}>
        <CategoryMatrix houseId={active.id} month={month} excludeCategoryIds={excludeCategoryIds} />
      </Suspense>
    </div>
  );
}
