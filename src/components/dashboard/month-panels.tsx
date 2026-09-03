import Link from "next/link";
import { ArrowRight, Check, CircleAlert, Handshake } from "lucide-react";
import {
  listBudgets,
  listCategories,
  listRecurrences,
  listSettlements,
  listTransactions,
} from "@/data/queries";
import { budgetProgress, committedInstallments } from "@/domain/finance";
import { installmentsDueIn, installmentSeries, reconcileRecurrences } from "@/domain/forecast";
import { monthSettlement } from "@/domain/settlement";
import { addMonths, monthLabel, monthShortLabel } from "@/domain/month";
import { formatCents, toCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { cn } from "@/lib/utils";
import type { MonthKey } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

export function PanelsSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }, (_, i) => (
        <Card key={i}>
          <Skeleton className="h-5 w-40" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
      ))}
    </>
  );
}

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1 text-[13px] text-brand hover:underline"
    >
      {label} <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

/**
 * Painéis do mês no Início (secao 7).
 *
 * Tudo aqui é leitura resumida do que tem tela própria: recorrências e
 * parcelas vivem em Previsão, orçamentos em Orçamentos, divisão em Acerto.
 * O Início mostra o suficiente para decidir se vale entrar, e leva para lá.
 */
export async function MonthPanels({
  houseId,
  month,
  members,
}: {
  houseId: string;
  month: MonthKey;
  members: MemberSummary[];
}) {
  const [monthTransactions, history, recurrences, budgets, categories, settlements] =
    await Promise.all([
      listTransactions(houseId, { month }),
      listTransactions(houseId, {
        fromMonth: addMonths(month, -12),
        toMonth: month,
        limit: 3000,
      }),
      listRecurrences(houseId),
      listBudgets(houseId, month),
      listCategories(houseId),
      listSettlements(houseId, month),
    ]);

  const matches = reconcileRecurrences(recurrences, history, month);
  const missing = matches.filter((m) => m.status === "missing");
  const divergent = matches.filter((m) => m.status === "divergent");
  const confirmed = matches.filter((m) => m.status === "confirmed");
  const recurringTotal = matches.reduce((s, m) => s + m.expectedCents, 0);

  const series = installmentSeries(history, month);
  const committed = committedInstallments(history, month, 3).map((c) => ({
    month: c.month,
    // A parcela futura não existe como lançamento ainda: vem da projeção da
    // série, não da soma de linhas que ainda não foram importadas.
    totalCents: installmentsDueIn(series, c.month),
  }));
  const committedTotal = committed.reduce((s, c) => s + c.totalCents, 0);

  // Conciliação: o que a fatura cobra além do consumo (secao 7).
  const fees = monthTransactions.filter((t) => t.type === "fee");
  const refunds = monthTransactions.filter((t) => t.type === "refund");
  const feeCents = fees.reduce((s, t) => s + toCents(t.amount), 0);
  const refundCents = refunds.reduce((s, t) => s + toCents(t.amount), 0);

  const spentByCategory = new Map<string | null, number>();
  for (const t of monthTransactions) {
    if (t.isHidden || t.categoryId === null) continue;
    const value =
      t.type === "expense" || t.type === "fee" || t.type === "adjustment"
        ? toCents(t.amount)
        : t.type === "refund"
          ? -toCents(t.amount)
          : 0;
    if (value === 0) continue;
    spentByCategory.set(
      t.categoryId,
      (spentByCategory.get(t.categoryId) ?? 0) + value,
    );
  }

  const budgetRows = budgets
    .map((b) => {
      const limitCents = toCents(b.limitAmount);
      const spentCents = spentByCategory.get(b.categoryId) ?? 0;
      return {
        name: categories.find((c) => c.id === b.categoryId)?.name ?? "Categoria",
        color: categories.find((c) => c.id === b.categoryId)?.color ?? "#8B8B94",
        progress: budgetProgress(spentCents, limitCents, month),
      };
    })
    .sort((a, b) => b.progress.ratio - a.progress.ratio);

  const settlement = monthSettlement(
    monthTransactions,
    members.map((m) => m.userId),
    month,
  );
  const settledKeys = new Set(
    settlements.map((s) => `${s.fromMember}:${s.toMember}`),
  );
  const openTransfers = settlement.transfers.filter(
    (t) => !settledKeys.has(`${t.fromMemberId}:${t.toMemberId}`),
  );

  return (
    <>
      <Card>
        <CardHeader
          title="Assinaturas e recorrências"
          description={
            matches.length > 0
              ? `${formatCents(recurringTotal)} previstos por mês.`
              : undefined
          }
          action={<SeeAll href="/previsao" label="Ver todas" />}
        />
        {matches.length === 0 ? (
          <p className="text-[13px] text-ink-faint">
            Nenhuma recorrência cadastrada. Aluguel, assinaturas e mensalidades
            entram em Previsão.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {[
              missing.length > 0
                ? {
                    key: "missing",
                    tone: "text-danger",
                    Icon: CircleAlert,
                    text: `${missing.length} não apareceu(ram) neste mês`,
                  }
                : null,
              divergent.length > 0
                ? {
                    key: "divergent",
                    tone: "text-attention",
                    Icon: CircleAlert,
                    text: `${divergent.length} veio(vieram) com valor diferente`,
                  }
                : null,
              confirmed.length > 0
                ? {
                    key: "confirmed",
                    tone: "text-positive",
                    Icon: Check,
                    text: `${confirmed.length} conferida(s) e no valor esperado`,
                  }
                : null,
            ]
              .filter((x) => x !== null)
              .map((row) => (
                <li key={row.key} className="flex items-center gap-2 text-[13px]">
                  <row.Icon className={cn("size-3.5 shrink-0", row.tone)} aria-hidden />
                  <span className="text-ink-muted">{row.text}</span>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Parcelas comprometidas"
          description="Próximos três meses."
          action={<SeeAll href="/previsao" label="Detalhes" />}
        />
        {committedTotal === 0 ? (
          <p className="text-[13px] text-ink-faint">
            Nenhuma parcela em aberto nos próximos meses.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {committed.map((c) => (
              <li
                key={c.month}
                className="rounded-[--radius-control] bg-surface-2 px-3 py-2.5 text-center"
              >
                <p className="text-[12px] uppercase tracking-[0.06em] text-ink-faint">
                  {monthShortLabel(c.month)}
                </p>
                <p className="tabular mt-1 text-sm font-semibold text-ink">
                  {formatCents(c.totalCents)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Conciliação"
          description="Estornos, IOF, tarifas e anuidade."
        />
        {fees.length === 0 && refunds.length === 0 ? (
          <p className="text-[13px] text-ink-faint">
            Nenhuma tarifa nem estorno em {monthLabel(month)}.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-[--radius-control] bg-surface-2 px-3 py-2.5">
              <dt className="text-[12px] text-ink-faint">
                Tarifas ({fees.length})
              </dt>
              <dd className="tabular mt-0.5 text-sm font-medium text-danger">
                {formatCents(feeCents)}
              </dd>
            </div>
            <div className="rounded-[--radius-control] bg-surface-2 px-3 py-2.5">
              <dt className="text-[12px] text-ink-faint">
                Estornos ({refunds.length})
              </dt>
              <dd className="tabular mt-0.5 text-sm font-medium text-positive">
                −{formatCents(refundCents)}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Orçamentos"
          description={
            budgetRows.length > 0
              ? `${budgetRows.filter((r) => r.progress.isOver).length} estourado(s) de ${budgetRows.length}.`
              : undefined
          }
          action={<SeeAll href={`/orcamentos?mes=${month}`} label="Definir" />}
        />
        {budgetRows.length === 0 ? (
          <p className="text-[13px] text-ink-faint">
            Nenhum limite definido para {monthLabel(month)}.
          </p>
        ) : (
          <ul className="space-y-2">
            {budgetRows.slice(0, 4).map((row) => (
              <li key={row.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                      aria-hidden
                    />
                    <span className="truncate text-[13px] text-ink">
                      {row.name}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-[13px] text-ink-muted">
                    {formatCents(row.progress.spentCents)}
                    <span className="text-ink-faint">
                      {" / "}
                      {formatCents(row.progress.limitCents)}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      row.progress.isOver
                        ? "bg-danger"
                        : row.progress.isWarning
                          ? "bg-attention"
                          : "bg-positive",
                    )}
                    style={{ width: `${Math.min(100, row.progress.ratio * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {members.length > 1 ? (
        <Card>
          <CardHeader
            title="Acerto do mês"
            description="Divisão do que é da casa."
            action={<SeeAll href={`/acerto?mes=${month}`} label="Abrir" />}
          />
          {openTransfers.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Check className="size-3.5 shrink-0 text-positive" aria-hidden />
              {settlement.sharedCents === 0
                ? "Nada compartilhado com responsável definido neste mês."
                : "As contas do mês estão empatadas."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {openTransfers.map((t) => (
                <li
                  key={`${t.fromMemberId}:${t.toMemberId}`}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <Handshake className="size-3.5 shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink-muted">
                    {members.find((m) => m.userId === t.fromMemberId)?.fullName}{" "}
                    deve a{" "}
                    {members.find((m) => m.userId === t.toMemberId)?.fullName}
                  </span>
                  <span className="tabular shrink-0 font-medium text-ink">
                    {formatCents(t.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}
