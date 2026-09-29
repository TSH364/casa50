import { CalendarClock, CreditCard } from "lucide-react";
import type { forecastMonths, installmentSeries } from "@/domain/forecast";
import { monthLabel } from "@/domain/month";
import type { Card as CardT, Category } from "@/domain/types";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/states";

/**
 * Os blocos da previsao (secao 8): os proximos meses e as parcelas abertas.
 * Vivem na tela de Analise, junto com os insights do mes.
 */

export function NextMonthsCard({ forecast }: { forecast: ReturnType<typeof forecastMonths> }) {
  return (
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
  );
}

export function InstallmentsCard({
  running,
  categories,
  cards,
}: {
  running: ReturnType<typeof installmentSeries>;
  categories: readonly Category[];
  cards: readonly CardT[];
}) {
  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? null;
  const cardName = (id: string | null) =>
    cards.find((c) => c.id === id)?.name ?? null;
  const committedTotal = running.reduce((s, i) => s + i.remainingCents, 0);

  return (
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
  );
}
