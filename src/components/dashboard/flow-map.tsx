import { listRecurrences, listTransactions } from "@/data/queries";
import { spendingCents } from "@/domain/finance";
import { forecastMonths } from "@/domain/forecast";
import { addMonths, monthRange, monthShortLabel } from "@/domain/month";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { cn } from "@/lib/utils";
import type { MonthKey } from "@/domain/types";

export function FlowMapSkeleton() {
  return (
    <Card>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-3 h-32 w-full" />
    </Card>
  );
}

/**
 * Mapa de fluxo (secao 7).
 *
 * Meses passados vêm de lançamentos reais; os próximos, da projeção. A regra
 * do produto é explícita: previsão fica marcada como previsão até a fatura
 * real ser importada. Por isso a barra prevista é hachurada e a legenda diz
 * o que é cada coisa — o gráfico não pode dar a um palpite a mesma aparência
 * de um fato.
 */
export async function FlowMap({
  houseId,
  month,
}: {
  houseId: string;
  month: MonthKey;
}) {
  const pastFrom = addMonths(month, -5);

  const [transactions, recurrences] = await Promise.all([
    listTransactions(houseId, {
      fromMonth: addMonths(month, -12),
      toMonth: month,
      limit: 3000,
    }),
    listRecurrences(houseId),
  ]);

  const realized = monthRange(pastFrom, month).map((m) => ({
    month: m,
    cents: transactions
      .filter((t) => t.invoiceMonth === m)
      .reduce((sum, t) => sum + spendingCents(t), 0),
    isForecast: false,
  }));

  const forecast = forecastMonths({
    transactions,
    recurrences,
    fromMonth: month,
    months: 3,
  }).map((f) => ({
    month: f.month,
    cents: f.totalCents,
    isForecast: true,
    hasEstimate: f.hasEstimate,
  }));

  const bars = [...realized, ...forecast];
  const max = Math.max(...bars.map((b) => b.cents), 1);
  const hasAnyData = bars.some((b) => b.cents > 0);

  return (
    <Card>
      <CardHeader
        title="Mapa de fluxo"
        description="Meses passados como realizado, próximos como previsão."
      />

      {!hasAnyData ? (
        <p className="text-[13px] text-ink-faint">
          Ainda não há lançamentos para desenhar o fluxo.
        </p>
      ) : (
        <>
          <ul className="flex items-end gap-1.5" style={{ height: "8rem" }}>
            {bars.map((bar) => {
              const height = Math.max(2, (bar.cents / max) * 100);
              const isCurrent = bar.month === month;
              return (
                <li
                  key={bar.month}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1"
                >
                  <span
                    className="tabular block text-center text-[10px] text-ink-faint"
                    aria-hidden
                  >
                    {bar.cents > 0 ? formatCentsCompact(bar.cents) : ""}
                  </span>
                  <span
                    role="img"
                    aria-label={`${monthShortLabel(bar.month)}: ${formatCents(bar.cents)}${
                      bar.isForecast ? " (previsto)" : ""
                    }`}
                    className={cn(
                      "block w-full rounded-t-[3px]",
                      bar.isForecast
                        ? // Hachura: previsão nunca ganha o mesmo preenchimento
                          // sólido de um mês que realmente aconteceu.
                          "border border-dashed border-brand/60 bg-brand/15"
                        : isCurrent
                          ? "bg-brand"
                          : "bg-brand/50",
                    )}
                    style={{ height: `${height}%` }}
                  />
                  <span className="block truncate text-center text-[10px] text-ink-faint">
                    {monthShortLabel(bar.month)}
                  </span>
                </li>
              );
            })}
          </ul>

          <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[12px]">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-brand" aria-hidden />
              <dt className="text-ink-faint">Realizado</dt>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm border border-dashed border-brand/60 bg-brand/15"
                aria-hidden
              />
              <dt className="text-ink-faint">Previsto</dt>
            </div>
            {forecast[0]?.hasEstimate === false ? (
              <dd className="text-ink-faint">
                A previsão inclui só o que já está comprometido — falta
                histórico para estimar o gasto variável.
              </dd>
            ) : null}
          </dl>
        </>
      )}
    </Card>
  );
}
