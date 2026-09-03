import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, CreditCard } from "lucide-react";
import { getActiveHouse, listMembers } from "@/lib/houses";
import {
  listCards,
  listCategories,
  listRecurrences,
  listTransactions,
} from "@/data/queries";
import {
  detectRecurrences,
  forecastMonths,
  installmentSeries,
  reconcileRecurrences,
} from "@/domain/forecast";
import { addMonths, currentMonth, isMonthKey, monthLabel } from "@/domain/month";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { MonthSwitcher } from "@/components/month-switcher";
import { RecurrencesPanel } from "@/components/forecast/recurrences-panel";

export const metadata: Metadata = { title: "Previsão · Fluxo" };

export default async function PrevisaoPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const month =
    params.mes && isMonthKey(params.mes) ? params.mes : currentMonth();

  const [transactions, recurrences, categories, cards, members] =
    await Promise.all([
      // Doze meses para trás: a detecção de recorrência precisa de sequência,
      // e as parcelas longas precisam do mês em que começaram.
      listTransactions(active.id, {
        fromMonth: addMonths(month, -12),
        toMonth: month,
        limit: 3000,
      }),
      listRecurrences(active.id),
      listCategories(active.id),
      listCards(active.id),
      listMembers(active.id),
    ]);

  const series = installmentSeries(transactions, month);
  const running = series.filter((s) => !s.isFinished);
  const matches = reconcileRecurrences(recurrences, transactions, month);
  const forecast = forecastMonths({
    transactions,
    recurrences,
    fromMonth: month,
  });

  // Só sugere o que ainda não está cadastrado.
  const known = new Set(
    recurrences.map((r) =>
      (r.merchant ?? r.description).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim(),
    ),
  );
  const candidates = detectRecurrences(transactions).filter(
    (c) => !known.has(c.merchantNormalized),
  );

  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? null;
  const cardName = (id: string | null) =>
    cards.find((c) => c.id === id)?.name ?? null;

  const committedTotal = running.reduce((s, i) => s + i.remainingCents, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} />
      </header>

      <Card>
        <CardHeader
          title="Próximos meses"
          description="Compromisso e estimativa aparecem separados, porque não são a mesma coisa."
        />
        <ul className="space-y-2">
          {forecast.map((m) => (
            <li
              key={m.month}
              className="rounded-[--radius-control] bg-surface-2 px-3 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-ink">{monthLabel(m.month)}</span>
                <span className="tabular text-base font-semibold text-ink">
                  {formatCents(m.totalCents)}
                </span>
              </div>

              <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-3">
                {[
                  { value: m.committedCents, className: "bg-danger" },
                  { value: m.recurringCents, className: "bg-brand" },
                  { value: m.estimatedCents, className: "bg-ink-faint/40" },
                ].map((part, i) =>
                  part.value > 0 && m.totalCents > 0 ? (
                    <span
                      key={i}
                      className={part.className}
                      style={{ width: `${(part.value / m.totalCents) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>

              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-danger" aria-hidden />
                  <dt className="text-ink-faint">Parcelas:</dt>
                  <dd className="tabular text-ink-muted">
                    {formatCents(m.committedCents)}
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-brand" aria-hidden />
                  <dt className="text-ink-faint">Recorrentes:</dt>
                  <dd className="tabular text-ink-muted">
                    {formatCents(m.recurringCents)}
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full bg-ink-faint/40"
                    aria-hidden
                  />
                  <dt className="text-ink-faint">Estimado:</dt>
                  <dd className="tabular text-ink-muted">
                    {m.hasEstimate ? formatCents(m.estimatedCents) : "sem base"}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[12px] text-ink-faint">
          {forecast[0]?.hasEstimate
            ? "O estimado é a média do gasto variável dos últimos meses — é palpite, não compromisso."
            : "Ainda não há histórico suficiente para estimar o gasto variável. Os valores acima são só o que já está comprometido."}
        </p>
      </Card>

      <RecurrencesPanel
        matches={matches}
        candidates={candidates}
        month={month}
        categories={categories}
        cards={cards}
        members={members}
      />

      <Card>
        <CardHeader
          title="Parcelas em andamento"
          description={
            running.length > 0
              ? `${formatCents(committedTotal)} ainda a pagar.`
              : undefined
          }
        />
        {running.length === 0 ? (
          <EmptyState
            title="Nenhuma parcela aberta"
            description="Compras parceladas aparecem aqui com quanto falta e quando terminam."
          />
        ) : (
          <ul className="space-y-2">
            {running.map((s) => (
              <li
                key={s.key}
                className="rounded-[--radius-control] bg-surface-2 px-3 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-ink">
                    {s.description}
                  </span>
                  <span className="tabular shrink-0 text-sm font-medium text-ink">
                    {formatCents(s.installmentCents)}
                    <span className="text-ink-faint">/mês</span>
                  </span>
                </div>

                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
                  role="img"
                  aria-label={`${s.paidCount} de ${s.totalCount} parcelas pagas`}
                >
                  <span
                    className="block h-full rounded-full bg-brand"
                    style={{ width: `${(s.paidCount / s.totalCount) * 100}%` }}
                  />
                </div>

                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-faint">
                  <span>
                    {s.paidCount}/{s.totalCount} pagas · faltam {s.remainingCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarClock className="size-3" aria-hidden />
                    termina em {monthLabel(s.endsOn)}
                  </span>
                  {cardName(s.cardId) ? (
                    <span className="flex items-center gap-1">
                      <CreditCard className="size-3" aria-hidden />
                      {cardName(s.cardId)}
                    </span>
                  ) : null}
                  {categoryName(s.categoryId) ? (
                    <span>{categoryName(s.categoryId)}</span>
                  ) : null}
                  <span className="text-ink-muted">
                    faltam {formatCents(s.remainingCents)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
