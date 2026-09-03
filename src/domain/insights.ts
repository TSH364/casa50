import type { Budget, Category, MonthKey, Transaction } from "./types";
import type { Cents } from "@/lib/money";
import { toCents } from "@/lib/money";
import { addMonths, monthDiff, monthRange } from "./month";
import { spendingCents, totalsByCategory } from "./finance";
import { installmentSeries, type RecurrenceMatch } from "./forecast";

/**
 * Insights (secao 14).
 *
 * A regra que governa este arquivo: **nenhum insight sem evidência**. Cada um
 * carrega os números que usou, e a interface mostra esses números junto com a
 * frase. Um aviso de "você gastou muito em Mercado" sem dizer quanto, contra o
 * quê e em que período é opinião, não informação — e a secao 20 proíbe exibir
 * conclusão sem base.
 *
 * O segundo princípio é o silêncio: sem histórico suficiente, a função devolve
 * lista vazia. Inventar comparação com um mês só é pior do que não comparar.
 */

export type InsightKind =
  | "category_spike"
  | "category_drop"
  | "budget_over"
  | "budget_warning"
  | "recurrence_increase"
  | "installments_ending"
  | "month_total";

export type InsightTone = "positive" | "neutral" | "attention" | "danger";

export interface InsightEvidence {
  label: string;
  value: string;
}

export interface Insight {
  id: string;
  kind: InsightKind;
  tone: InsightTone;
  title: string;
  /** Frase curta. O detalhe fica na evidência, não aqui. */
  detail: string;
  /** Os números que sustentam a frase. Nunca vazio. */
  evidence: InsightEvidence[];
  /** Para a tela poder levar ao recorte exato que gerou o insight. */
  href?: string;
  /** Ordena a lista: quanto maior, mais no topo. */
  weight: number;
}

function brl(cents: Cents): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export interface InsightInput {
  month: MonthKey;
  transactions: readonly Transaction[];
  categories: readonly Category[];
  budgets: readonly Budget[];
  recurrenceMatches: readonly RecurrenceMatch[];
  /** Meses de histórico a considerar nas comparações. */
  historyMonths?: number;
}

/**
 * Compara o mês com a média dos anteriores, por categoria.
 *
 * Exige pelo menos dois meses de base. Com um mês só, "dobrou" é ruído: o
 * primeiro mês de uso do app sempre pareceria anômalo.
 */
function categoryComparisons(input: InsightInput): Insight[] {
  const { month, transactions, categories } = input;
  const historyMonths = input.historyMonths ?? 3;
  const pastMonths = monthRange(addMonths(month, -historyMonths), addMonths(month, -1));

  const nameOf = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "Sem categoria";

  const current = new Map(
    totalsByCategory(transactions, month).map((t) => [t.categoryId, t.totalCents]),
  );

  const insights: Insight[] = [];

  for (const [categoryId, currentCents] of current) {
    const history: Cents[] = [];
    for (const past of pastMonths) {
      const total = totalsByCategory(transactions, past).find(
        (t) => t.categoryId === categoryId,
      );
      // Mês sem gasto na categoria conta como zero, não como ausência: o casal
      // pode ter simplesmente não gasto, e ignorar isso inflaria a média.
      if (transactions.some((t) => t.invoiceMonth === past)) {
        history.push(total?.totalCents ?? 0);
      }
    }

    if (history.length < 2) continue;

    const average = Math.round(
      history.reduce((a, b) => a + b, 0) / history.length,
    );
    if (average === 0) continue;

    const ratio = currentCents / average;
    const difference = currentCents - average;

    // Só vale insight quando a variação é grande E o valor é relevante.
    // 30% de R$ 12,00 não merece um aviso na tela.
    if (Math.abs(difference) < 5000) continue;

    const evidence: InsightEvidence[] = [
      { label: "Neste mês", value: brl(currentCents) },
      {
        label: `Média de ${history.length} ${history.length === 1 ? "mês" : "meses"}`,
        value: brl(average),
      },
      {
        label: "Diferença",
        value: `${difference > 0 ? "+" : "−"}${brl(Math.abs(difference))}`,
      },
    ];

    const href = categoryId
      ? `/extratos?mes=${month}`
      : undefined;

    if (ratio >= 1.3) {
      insights.push({
        id: `spike:${categoryId ?? "sem"}`,
        kind: "category_spike",
        tone: ratio >= 2 ? "danger" : "attention",
        title: `${nameOf(categoryId)} acima da média`,
        detail: `Gasto ${percent(ratio - 1)} maior que a média dos últimos meses.`,
        evidence,
        href,
        weight: Math.abs(difference),
      });
    } else if (ratio <= 0.7) {
      insights.push({
        id: `drop:${categoryId ?? "sem"}`,
        kind: "category_drop",
        tone: "positive",
        title: `${nameOf(categoryId)} abaixo da média`,
        detail: `Gasto ${percent(1 - ratio)} menor que a média dos últimos meses.`,
        evidence,
        href,
        weight: Math.abs(difference) / 2,
      });
    }
  }

  return insights;
}

function budgetAlerts(input: InsightInput): Insight[] {
  const { month, transactions, categories, budgets } = input;
  const spent = new Map(
    totalsByCategory(transactions, month).map((t) => [t.categoryId, t.totalCents]),
  );

  const insights: Insight[] = [];

  for (const budget of budgets) {
    if (budget.month !== month) continue;
    const limitCents = toCents(budget.limitAmount);
    if (limitCents <= 0) continue;

    const spentCents = spent.get(budget.categoryId) ?? 0;
    const ratio = spentCents / limitCents;
    if (ratio < 0.8) continue;

    const name =
      categories.find((c) => c.id === budget.categoryId)?.name ?? "Categoria";
    const over = spentCents - limitCents;

    const evidence: InsightEvidence[] = [
      { label: "Gasto", value: brl(spentCents) },
      { label: "Limite", value: brl(limitCents) },
      {
        label: over > 0 ? "Passou" : "Ainda cabe",
        value: brl(Math.abs(over)),
      },
    ];

    insights.push(
      over > 0
        ? {
            id: `budget-over:${budget.categoryId}`,
            kind: "budget_over",
            tone: "danger",
            title: `${name} estourou o orçamento`,
            detail: `O limite do mês foi ultrapassado em ${brl(over)}.`,
            evidence,
            href: `/orcamentos?mes=${month}`,
            weight: 1_000_000 + over,
          }
        : {
            id: `budget-warning:${budget.categoryId}`,
            kind: "budget_warning",
            tone: "attention",
            title: `${name} perto do limite`,
            detail: `${percent(ratio)} do orçamento do mês já foi usado.`,
            evidence,
            href: `/orcamentos?mes=${month}`,
            weight: 500_000 + spentCents,
          },
    );
  }

  return insights;
}

function recurrenceChanges(input: InsightInput): Insight[] {
  return input.recurrenceMatches
    .filter((m) => m.status === "divergent" && m.differenceCents > 0)
    .map((m) => ({
      id: `recurrence:${m.recurrence.id}`,
      kind: "recurrence_increase" as const,
      tone: "attention" as const,
      title: `${m.recurrence.description} aumentou`,
      detail: `Veio ${brl(m.differenceCents)} acima do valor cadastrado.`,
      evidence: [
        { label: "Cadastrado", value: brl(m.expectedCents) },
        { label: "Cobrado", value: brl(m.actualCents ?? 0) },
        { label: "Diferença", value: `+${brl(m.differenceCents)}` },
      ],
      href: "/previsao",
      weight: 200_000 + m.differenceCents,
    }));
}

/**
 * Parcelas que terminam neste mês ou no próximo.
 *
 * É o raro insight de boa notícia com número exato: a partir do mês seguinte
 * aquele valor deixa de sair, e vale dizer quanto.
 */
function endingInstallments(input: InsightInput): Insight[] {
  const series = installmentSeries(input.transactions, input.month);
  const ending = series.filter(
    (s) => !s.isFinished && s.remainingCount <= 1 && monthDiff(s.latestMonth, input.month) <= 1,
  );
  if (ending.length === 0) return [];

  const freed = ending.reduce((sum, s) => sum + s.installmentCents, 0);

  return [
    {
      id: "installments-ending",
      kind: "installments_ending",
      tone: "positive",
      title:
        ending.length === 1
          ? "Uma parcela está acabando"
          : `${ending.length} parcelas estão acabando`,
      detail: `A partir do mês seguinte, ${brl(freed)} deixam de sair por mês.`,
      evidence: [
        ...ending.slice(0, 3).map((s) => ({
          label: s.description,
          value: `${brl(s.installmentCents)}/mês · última em ${s.endsOn}`,
        })),
        { label: "Total liberado por mês", value: brl(freed) },
      ],
      href: "/previsao",
      weight: 100_000 + freed,
    },
  ];
}

function monthTotal(input: InsightInput): Insight[] {
  const { month, transactions } = input;
  const previous = addMonths(month, -1);

  const sum = (m: MonthKey) =>
    transactions
      .filter((t) => t.invoiceMonth === m && !t.isHidden)
      .reduce((s, t) => s + spendingCents(t), 0);

  const hasPrevious = transactions.some((t) => t.invoiceMonth === previous);
  if (!hasPrevious) return [];

  const currentCents = sum(month);
  const previousCents = sum(previous);
  if (previousCents === 0) return [];

  const difference = currentCents - previousCents;
  if (Math.abs(difference) < 10000) return [];

  return [
    {
      id: "month-total",
      kind: "month_total",
      tone: difference > 0 ? "attention" : "positive",
      title:
        difference > 0
          ? "O mês está mais caro que o anterior"
          : "O mês está mais barato que o anterior",
      detail: `Diferença de ${brl(Math.abs(difference))} em relação ao mês passado.`,
      evidence: [
        { label: "Este mês", value: brl(currentCents) },
        { label: "Mês anterior", value: brl(previousCents) },
        {
          label: "Variação",
          value: `${difference > 0 ? "+" : "−"}${percent(Math.abs(difference) / previousCents)}`,
        },
      ],
      href: `/extratos?mes=${month}`,
      weight: 50_000,
    },
  ];
}

/**
 * Monta a lista de insights do mês, do mais relevante para o menos.
 *
 * Devolve vazio sem hesitação quando não há base. A tela trata isso como
 * estado próprio e explica o que falta, em vez de mostrar caixa vazia.
 */
export function buildInsights(input: InsightInput): Insight[] {
  return [
    ...budgetAlerts(input),
    ...recurrenceChanges(input),
    ...categoryComparisons(input),
    ...endingInstallments(input),
    ...monthTotal(input),
  ].sort((a, b) => b.weight - a.weight);
}

/** Quantos meses distintos de histórico existem — a tela usa para explicar. */
export function historyDepth(
  transactions: readonly Transaction[],
): number {
  return new Set(transactions.map((t) => t.invoiceMonth)).size;
}
