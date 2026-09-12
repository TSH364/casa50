import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  listBudgets,
  listCalendarEvents,
  listCalendarSources,
  listRecurrences,
  listTransactions,
} from "@/data/queries";
import { monthPressure } from "@/domain/calendar";
import { budgetStates, rebalancePlan } from "@/domain/rebalance";
import { addMonths, currentMonth, daysInMonth, monthLabel } from "@/domain/month";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { RebalanceApply } from "./rebalance-apply";
import type { Category, MonthKey } from "@/domain/types";

/**
 * Realocação do mês a partir da agenda (camada 3).
 *
 * O painel só existe quando as três condições se somam: há compromisso caro
 * marcado, há histórico que diga quanto ele custa, e há orçamento cadastrado
 * para realocar. Faltando qualquer uma, a tela não mostra nada - propor
 * remanejo em cima de estimativa sem base seria dar palpite com cara de
 * cálculo, e a secao 20 não permite.
 *
 * O que ele mostra é uma PROPOSTA: de quanto para quanto, em cada categoria, e
 * o motivo. Quem decide é o casal.
 */

const HISTORY = 12;

const MOTIVO = {
  slack: "o limite estava acima do gasto habitual",
  cut: "vai precisar gastar menos",
} as const;

export async function RebalancePanel({
  houseId,
  month,
  categories,
  excludeCategoryIds,
}: {
  houseId: string;
  month: MonthKey;
  categories: Category[];
  /** Categorias fora dos totais da casa. Vem de `houseView`. */
  excludeCategoryIds: string[];
}) {
  // Mês fechado não se replaneja: o dinheiro já saiu.
  if (month < currentMonth()) return null;

  const sources = await listCalendarSources(houseId);
  if (sources.length === 0) return null;

  const historyFrom = addMonths(month, -HISTORY);
  const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

  const [events, transactions, budgets, recurrences] = await Promise.all([
    listCalendarEvents(houseId, { from: `${historyFrom}-01`, to: lastDay }),
    listTransactions(houseId, {
      fromMonth: historyFrom,
      toMonth: addMonths(month, 1),
      excludeCategoryIds,
      limit: 3000,
    }),
    listBudgets(houseId, month),
    listRecurrences(houseId),
  ]);

  const pressure = monthPressure(month, events, transactions, {
    today: new Date().toISOString().slice(0, 10),
  });
  if (!pressure.hasEstimate || pressure.extraCents <= 0) return null;

  const states = budgetStates({
    budgets,
    transactions,
    recurrences,
    month,
    referenceMonth: currentMonth(),
  });
  const plan = rebalancePlan(states, pressure.extraCents);

  const nameOf = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? "Categoria";
  const colorOf = (id: string) =>
    categories.find((c) => c.id === id)?.color ?? "#8B8B94";

  if (plan.proposals.length === 0) {
    return (
      <Card>
        <CardHeader
          title="A agenda pressiona este mês"
          description={`${monthLabel(month)} aponta ${formatCents(pressure.extraCents)} acima de um mês comum.`}
        />
        <p className="text-[13px] text-ink-muted">
          {states.length === 0
            ? "Não há orçamento cadastrado neste mês, então não há limite para realocar. Defina os limites abaixo e a proposta aparece aqui."
            : "Nenhuma categoria tem folga para ceder: o que está cadastrado já é compromisso assumido ou já foi gasto."}
        </p>
      </Card>
    );
  }

  const changes = plan.proposals.map((p) => ({
    categoryId: p.categoryId,
    limitCents: p.toCents,
  }));

  return (
    <Card>
      <CardHeader
        title="Equalizar o mês"
        description={`A agenda aponta ${formatCents(pressure.extraCents)} acima do comum. Esta é uma forma de abrir espaço.`}
        action={<RebalanceApply month={month} changes={changes} />}
      />

      <ul className="space-y-2">
        {plan.proposals.map((p) => (
          <li
            key={p.categoryId}
            className="rounded-[--radius-control] bg-surface-2 px-3 py-3"
          >
            <div className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: colorOf(p.categoryId) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {nameOf(p.categoryId)}
              </span>
            </div>

            {/* De → para, com os dois números à vista: a proposta precisa ser
                verificável de relance, não aceita no escuro. */}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="tabular text-ink-faint line-through">
                {formatCents(p.fromCents)}
              </span>
              <ArrowRight className="size-3.5 text-ink-faint" aria-hidden />
              <span className="tabular font-semibold text-ink">
                {formatCents(p.toCents)}
              </span>
              <span className="tabular text-[12px] text-brand">
                libera {formatCents(p.freedCents)}
              </span>
            </p>

            <p className="mt-1 text-[12px] text-ink-faint">
              {MOTIVO[p.reason]}
              {p.typicalCents > 0
                ? ` · costuma gastar ${formatCents(p.typicalCents)}`
                : ""}
              {p.spentCents > 0 ? ` · já gastou ${formatCents(p.spentCents)}` : ""}
            </p>
          </li>
        ))}
      </ul>

      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[12px]">
        <div className="flex items-center gap-1.5">
          <dt className="text-ink-faint">Precisa abrir:</dt>
          <dd className="tabular text-ink-muted">{formatCents(plan.needCents)}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-ink-faint">A proposta abre:</dt>
          <dd className="tabular text-ink">{formatCents(plan.freedCents)}</dd>
        </div>
        {plan.shortfallCents > 0 ? (
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-faint">Ainda falta:</dt>
            <dd className="tabular text-attention">
              {formatCents(plan.shortfallCents)}
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-2 text-[12px] text-ink-faint">
        Parcelas e contas recorrentes do mês não entram no corte, e nenhum
        limite cai abaixo do que já foi gasto.{" "}
        <Link href="/previsao" className="text-brand underline-offset-4 hover:underline">
          Ver os compromissos
        </Link>
        .
      </p>
    </Card>
  );
}
