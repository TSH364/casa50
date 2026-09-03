import { toCents, type Cents } from "@/lib/money";
import { addMonths, daysInMonth, daysRemaining } from "./month";
import type {
  ForecastStatus,
  MonthKey,
  Transaction,
  TransactionType,
} from "./types";

/**
 * Regras financeiras puras: sem I/O, sem React, sem Supabase.
 * Tudo aqui e testavel isoladamente (tests/unit) e opera em centavos.
 */

/** Status que representam dinheiro que de fato saiu. */
const REALIZED: readonly ForecastStatus[] = ["confirmed", "divergent"];

/**
 * Quanto o lancamento soma ao "total gasto" do mes, em centavos.
 *
 * Cada tipo tem um papel distinto e misturar dois deles numa unica funcao
 * (como somar receita com sinal invertido dentro da despesa) faz os cards
 * "total gasto" e "receitas" da secao 7 sairem do mesmo numero e nunca
 * fecharem. Por isso despesa e receita tem funcoes separadas.
 *
 *   expense/fee/adjustment -> soma
 *   refund                 -> subtrai (secao 12: estorno nao e despesa nova)
 *   income                 -> zero, contabilizado em `incomeCents`
 *   payment                -> zero, e a quitacao da fatura, nao um gasto novo
 *
 * `spendingOfCents` e a mesma regra sem depender de um `Transaction` pronto,
 * para o total da importacao sair daqui em vez de reimplementar o sinal. As
 * duas ja divergiram: a importacao subtraia o pagamento que a tela conta como
 * zero, e a fatura do Itau aparecia negativa porque o pagamento da fatura
 * anterior (R$ 18.151,91) era maior que as compras do mes.
 */
export function spendingOfCents(
  type: TransactionType,
  amountCents: Cents,
): Cents {
  switch (type) {
    case "expense":
    case "fee":
    case "adjustment":
      return amountCents;
    case "refund":
      return -amountCents;
    case "income":
    case "payment":
      return 0;
  }
}

export function spendingCents(t: Transaction): Cents {
  if (t.isHidden) return 0;
  return spendingOfCents(t.type, toCents(t.amount));
}

/** Quanto o lancamento soma as receitas do mes, em centavos. */
export function incomeCents(t: Transaction): Cents {
  if (t.isHidden || t.type !== "income") return 0;
  return toCents(t.amount);
}

export interface SummaryOptions {
  /** `null` = todos os membros. */
  memberId?: string | null;
  /** `null` = todos os cartoes. */
  cardId?: string | null;
  /** Categorias ocultadas pelo usuario na tela "Para onde foi". */
  hiddenCategoryIds?: ReadonlySet<string>;
}

function matches(t: Transaction, month: MonthKey, o: SummaryOptions): boolean {
  if (t.invoiceMonth !== month) return false;
  if (o.memberId != null && t.memberId !== o.memberId) return false;
  if (o.cardId != null && t.cardId !== o.cardId) return false;
  return true;
}

export interface MonthSummary {
  month: MonthKey;
  /** Realizado, ja liquido de estornos. */
  spentCents: Cents;
  incomeCents: Cents;
  /** Receitas menos despesas. Negativo significa gasto acima da entrada. */
  balanceCents: Cents;
  /** Quantos lancamentos entraram na conta. */
  count: number;
  /** Lancamentos ainda marcados como previsao para este mes. */
  forecastCents: Cents;
  /** Parte do realizado que veio de compras parceladas. */
  installmentCents: Cents;
  /** Total antes de esconder categorias - o "bruto da fatura" da secao 7. */
  grossSpentCents: Cents;
  /** Quanto foi retirado da visao pelas categorias ocultas. */
  hiddenCents: Cents;
}

export function summarizeMonth(
  transactions: readonly Transaction[],
  month: MonthKey,
  options: SummaryOptions = {},
): MonthSummary {
  const hidden = options.hiddenCategoryIds ?? new Set<string>();
  const summary: MonthSummary = {
    month,
    spentCents: 0,
    incomeCents: 0,
    balanceCents: 0,
    count: 0,
    forecastCents: 0,
    installmentCents: 0,
    grossSpentCents: 0,
    hiddenCents: 0,
  };

  for (const t of transactions) {
    if (!matches(t, month, options)) continue;

    if (t.status === "forecast") {
      summary.forecastCents += spendingCents(t);
      continue;
    }
    if (!REALIZED.includes(t.status)) continue; // cancelled, missing

    const spend = spendingCents(t);
    summary.grossSpentCents += spend;

    if (t.categoryId !== null && hidden.has(t.categoryId)) {
      summary.hiddenCents += spend;
      continue;
    }

    summary.spentCents += spend;
    summary.incomeCents += incomeCents(t);
    if (t.installment !== null) summary.installmentCents += spend;
    summary.count += 1;
  }

  summary.balanceCents = summary.incomeCents - summary.spentCents;
  return summary;
}

export interface CategoryTotal {
  categoryId: string | null;
  totalCents: Cents;
  count: number;
  /** Fatia do total do mes, de 0 a 1. */
  share: number;
}

/** Totais por categoria, do maior para o menor. `null` = sem categoria. */
export function totalsByCategory(
  transactions: readonly Transaction[],
  month: MonthKey,
  options: SummaryOptions = {},
): CategoryTotal[] {
  const buckets = new Map<string | null, { totalCents: Cents; count: number }>();

  for (const t of transactions) {
    if (!matches(t, month, options)) continue;
    if (!REALIZED.includes(t.status)) continue;

    const spend = spendingCents(t);
    if (spend === 0) continue;

    const key = t.categoryId;
    const bucket = buckets.get(key) ?? { totalCents: 0, count: 0 };
    bucket.totalCents += spend;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const total = [...buckets.values()].reduce((sum, b) => sum + b.totalCents, 0);

  return [...buckets.entries()]
    .map(([categoryId, b]) => ({
      categoryId,
      totalCents: b.totalCents,
      count: b.count,
      share: total === 0 ? 0 : b.totalCents / total,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export interface CommittedMonth {
  month: MonthKey;
  totalCents: Cents;
  count: number;
  items: Transaction[];
}

/**
 * Parcelas ja comprometidas nos proximos `months` meses (secao 7).
 *
 * Devolve sempre uma entrada por mes, mesmo vazia, para que a interface possa
 * renderizar tres cards estaveis em vez de somer com um mes sem parcelas.
 */
export function committedInstallments(
  transactions: readonly Transaction[],
  fromMonth: MonthKey,
  months = 3,
): CommittedMonth[] {
  const target = new Map<MonthKey, CommittedMonth>();
  for (let i = 1; i <= months; i += 1) {
    const month = addMonths(fromMonth, i);
    target.set(month, { month, totalCents: 0, count: 0, items: [] });
  }

  for (const t of transactions) {
    if (t.installment === null || t.isHidden) continue;
    if (t.status === "cancelled" || t.status === "missing") continue;

    const bucket = target.get(t.invoiceMonth);
    if (bucket === undefined) continue;

    bucket.totalCents += spendingCents(t);
    bucket.count += 1;
    bucket.items.push(t);
  }

  for (const bucket of target.values()) {
    bucket.items.sort((a, b) => a.date.localeCompare(b.date));
  }
  return [...target.values()];
}

export interface BudgetProgress {
  limitCents: Cents;
  spentCents: Cents;
  /** 0 a 1 dentro do limite; passa de 1 quando estoura. */
  ratio: number;
  /** Quanto ainda cabe. Zero quando ja estourou. */
  remainingCents: Cents;
  /** Quanto passou do limite. Zero quando esta dentro. */
  overCents: Cents;
  isOver: boolean;
  /** A partir de 80% do limite a secao 7 pede alerta. */
  isWarning: boolean;
  daysLeft: number;
  /** Quanto da para gastar por dia ate o fim do mes sem estourar. */
  dailyPaceCents: Cents;
}

export function budgetProgress(
  spentCents: Cents,
  limitCents: Cents,
  month: MonthKey,
  now: Date = new Date(),
): BudgetProgress {
  const over = Math.max(0, spentCents - limitCents);
  const remaining = Math.max(0, limitCents - spentCents);
  const daysLeft = daysRemaining(month, now);

  return {
    limitCents,
    spentCents,
    ratio: limitCents === 0 ? 0 : spentCents / limitCents,
    remainingCents: remaining,
    overCents: over,
    isOver: over > 0,
    isWarning: limitCents > 0 && spentCents >= limitCents * 0.8,
    daysLeft,
    // Um mes ja encerrado nao tem ritmo diario: dividir por zero aqui
    // produziria Infinity na interface.
    dailyPaceCents: daysLeft === 0 ? 0 : Math.floor(remaining / daysLeft),
  };
}

/**
 * Limite sugerido a partir da media historica (secao 7).
 * Devolve `null` quando nao ha meses suficientes para uma media honesta.
 */
export function suggestBudget(
  monthlyTotals: readonly Cents[],
  minMonths = 3,
): Cents | null {
  if (monthlyTotals.length < minMonths) return null;
  const sum = monthlyTotals.reduce((a, b) => a + b, 0);
  return Math.round(sum / monthlyTotals.length);
}

/** Media de um mes "cheio" projetada a partir do ritmo ate agora. */
export function projectMonthEnd(
  spentCents: Cents,
  month: MonthKey,
  now: Date = new Date(),
): Cents {
  const total = daysInMonth(month);
  const elapsed = total - daysRemaining(month, now) + 1;
  if (elapsed <= 0) return spentCents;
  return Math.round((spentCents / Math.min(elapsed, total)) * total);
}
