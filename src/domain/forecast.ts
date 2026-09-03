import type { MonthKey, Recurrence, Transaction } from "./types";
import type { Cents } from "@/lib/money";
import { toCents } from "@/lib/money";
import { addMonths, daysInMonth, monthDiff } from "./month";
import { spendingCents } from "./finance";

/**
 * Parcelas, recorrências, conciliação e previsão (secoes 9, 10 e 11).
 *
 * Regra que atravessa o arquivo inteiro: o que é compromisso assumido e o que
 * é estimativa nunca se misturam num número só. Parcela lançada é fato;
 * recorrência é expectativa; média de gasto variável é chute. A secao 11 exige
 * que a interface saiba dizer qual é qual, então o domínio devolve os três
 * separados e deixa a soma para quem for exibir.
 */

// --------------------------------------------------------------------------
// Séries de parcelas (secao 9)
// --------------------------------------------------------------------------

export interface InstallmentSeries {
  key: string;
  description: string;
  merchantNormalized: string;
  /** Quantas parcelas a compra tem no total. */
  totalCount: number;
  /** Maior parcela já vista nos lançamentos. */
  paidCount: number;
  remainingCount: number;
  installmentCents: Cents;
  /** Quanto ainda falta pagar: parcelas restantes x valor da parcela. */
  remainingCents: Cents;
  /** Valor total da compra, somando todas as parcelas. */
  purchaseCents: Cents;
  /** Mês da parcela mais recente encontrada. */
  latestMonth: MonthKey;
  /** Mês em que a última parcela cai. */
  endsOn: MonthKey;
  categoryId: string | null;
  cardId: string | null;
  isFinished: boolean;
}

/**
 * Agrupa lançamentos parcelados em compras.
 *
 * A chave junta estabelecimento normalizado, total de parcelas e valor da
 * parcela. Sem o valor, duas compras diferentes na mesma loja em 10x virariam
 * uma só; sem o total, a 3/10 e a 3/12 se confundiriam.
 */
export function installmentSeries(
  transactions: readonly Transaction[],
  referenceMonth: MonthKey,
): InstallmentSeries[] {
  const groups = new Map<string, Transaction[]>();

  for (const t of transactions) {
    if (t.installment === null || t.isHidden) continue;
    if (t.status === "cancelled") continue;

    const merchant = t.merchantNormalized ?? t.description.toUpperCase();
    const key = `${merchant}|${t.installment.total}|${toCents(t.amount)}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const series: InstallmentSeries[] = [];

  for (const [key, items] of groups) {
    // A parcela mais adiantada é a que diz onde a compra está hoje. Usar a
    // contagem de lançamentos daria errado quando faltam meses no histórico
    // - importar agosto e outubro não significa que setembro não aconteceu.
    const latest = items.reduce((a, b) =>
      b.installment!.current > a.installment!.current ? b : a,
    );
    const first = items[0]!;
    const total = latest.installment!.total;
    const paid = latest.installment!.current;
    const remaining = Math.max(0, total - paid);
    const installmentCents = toCents(latest.amount);

    series.push({
      key,
      description: first.merchantAlias ?? first.description,
      merchantNormalized: first.merchantNormalized ?? "",
      totalCount: total,
      paidCount: paid,
      remainingCount: remaining,
      installmentCents,
      remainingCents: remaining * installmentCents,
      purchaseCents: total * installmentCents,
      latestMonth: latest.invoiceMonth,
      endsOn: addMonths(latest.invoiceMonth, remaining),
      categoryId: latest.categoryId,
      cardId: latest.cardId,
      isFinished: remaining === 0,
    });
  }

  return series.sort((a, b) => {
    // Em andamento primeiro, e dentro disso o que compromete mais.
    if (a.isFinished !== b.isFinished) return a.isFinished ? 1 : -1;
    return b.remainingCents - a.remainingCents;
  });
}

/** Quanto das parcelas conhecidas cai num mês futuro específico. */
export function installmentsDueIn(
  series: readonly InstallmentSeries[],
  month: MonthKey,
): Cents {
  let total = 0;
  for (const s of series) {
    if (s.isFinished) continue;
    const ahead = monthDiff(s.latestMonth, month);
    // `ahead` conta quantos meses à frente da última parcela vista; entre 1 e
    // o número de parcelas restantes, existe uma parcela caindo neste mês.
    if (ahead >= 1 && ahead <= s.remainingCount) total += s.installmentCents;
  }
  return total;
}

// --------------------------------------------------------------------------
// Conciliação de recorrências (secao 10)
// --------------------------------------------------------------------------

export type ReconcileStatus =
  /** Apareceu, com o valor esperado. */
  | "confirmed"
  /** Apareceu, com valor diferente do combinado. */
  | "divergent"
  /** Não apareceu, e o dia esperado já passou. */
  | "missing"
  /** Não apareceu ainda, mas o dia esperado não chegou. */
  | "pending";

export interface RecurrenceMatch {
  recurrence: Recurrence;
  status: ReconcileStatus;
  transaction: Transaction | null;
  expectedCents: Cents;
  actualCents: Cents | null;
  /** Positivo quando veio mais caro do que o esperado. */
  differenceCents: Cents;
}

/** Normalização leve, só para comparar recorrência com lançamento. */
function compareKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Uma recorrência casa com um lançamento quando os nomes se contêm.
 *
 * Comparar por igualdade exata falharia sempre: a recorrência é "Netflix" e o
 * lançamento chega como "NETFLIX.COM". Comparar por valor seria pior ainda -
 * duas assinaturas de R$ 55,90 no mesmo mês trocariam de lugar.
 */
function matches(recurrence: Recurrence, t: Transaction): boolean {
  const target = compareKey(recurrence.merchant ?? recurrence.description);
  if (target === "") return false;
  const candidate = compareKey(
    t.merchantNormalized ?? t.merchantOriginal ?? t.description,
  );
  return candidate.includes(target) || target.includes(candidate);
}

/** Diferença aceitável antes de chamar de divergente: 1% ou R$ 1, o que for maior. */
function tolerance(expectedCents: Cents): Cents {
  return Math.max(100, Math.round(expectedCents * 0.01));
}

/**
 * Confere, mês a mês, o que era esperado contra o que apareceu (secao 10).
 *
 * `now` entra como parâmetro para o teste poder fixar a data - e para o mês
 * corrente não acusar como ausente uma conta que ainda vai vencer.
 */
export function reconcileRecurrences(
  recurrences: readonly Recurrence[],
  transactions: readonly Transaction[],
  month: MonthKey,
  now: Date = new Date(),
): RecurrenceMatch[] {
  const inMonth = transactions.filter(
    (t) => t.invoiceMonth === month && !t.isHidden && t.status !== "cancelled",
  );
  const taken = new Set<string>();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return recurrences
    .filter((r) => r.isActive)
    .map((recurrence) => {
      const expectedCents = toCents(recurrence.amount);
      // Cada lançamento serve a uma recorrência só: sem isso, duas assinaturas
      // de nome parecido apontariam para a mesma linha e uma sumiria.
      const found =
        inMonth.find((t) => !taken.has(t.id) && matches(recurrence, t)) ?? null;

      if (found) {
        taken.add(found.id);
        const actualCents = spendingCents(found);
        const difference = actualCents - expectedCents;
        return {
          recurrence,
          status:
            Math.abs(difference) > tolerance(expectedCents)
              ? ("divergent" as const)
              : ("confirmed" as const),
          transaction: found,
          expectedCents,
          actualCents,
          differenceCents: difference,
        };
      }

      // Mês passado sem o lançamento é ausência. Mês corrente só vira ausência
      // depois do dia esperado - antes disso a conta simplesmente não venceu,
      // e alarmar seria mentira.
      let status: ReconcileStatus = "missing";
      if (month > currentMonthKey) {
        status = "pending";
      } else if (month === currentMonthKey) {
        const dueDay = Math.min(
          recurrence.expectedDay ?? daysInMonth(month),
          daysInMonth(month),
        );
        status = now.getDate() < dueDay ? "pending" : "missing";
      }

      return {
        recurrence,
        status,
        transaction: null,
        expectedCents,
        actualCents: null,
        differenceCents: 0,
      };
    });
}

// --------------------------------------------------------------------------
// Detecção de recorrências (secao 10)
// --------------------------------------------------------------------------

export interface RecurrenceCandidate {
  merchantNormalized: string;
  description: string;
  /** Mediana dos valores vistos, mais estável que a média com um outlier. */
  amountCents: Cents;
  months: MonthKey[];
  /** Dia do mês mais frequente. */
  expectedDay: number | null;
  categoryId: string | null;
  cardId: string | null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

/**
 * Sugere recorrências a partir do histórico.
 *
 * Exige o mesmo estabelecimento em `minMonths` meses distintos e consecutivos,
 * com valores próximos. Parcelas ficam de fora: elas repetem e terminam, e
 * tratá-las como assinatura projetaria cobrança para sempre.
 *
 * O resultado é sugestão, nunca cadastro automático - a secao 10 pede
 * confirmação humana antes de virar recorrência.
 */
export function detectRecurrences(
  transactions: readonly Transaction[],
  minMonths = 3,
): RecurrenceCandidate[] {
  const groups = new Map<string, Transaction[]>();

  for (const t of transactions) {
    if (t.isHidden || t.installment !== null) continue;
    if (t.type !== "expense" && t.type !== "fee") continue;
    const key = t.merchantNormalized ?? "";
    if (key === "") continue;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const candidates: RecurrenceCandidate[] = [];

  for (const [merchant, items] of groups) {
    const byMonth = new Map<MonthKey, Transaction>();
    for (const t of items) {
      // Mais de um no mesmo mês: fica o primeiro. Um mês com duas compras na
      // mesma loja é consumo avulso, não assinatura.
      if (!byMonth.has(t.invoiceMonth)) byMonth.set(t.invoiceMonth, t);
    }

    const months = [...byMonth.keys()].sort();
    if (months.length < minMonths) continue;

    // Precisa ser uma sequência sem buraco terminando no mês mais recente.
    const tail: MonthKey[] = [months[months.length - 1]!];
    for (let i = months.length - 2; i >= 0; i -= 1) {
      if (monthDiff(months[i]!, tail[0]!) === 1) tail.unshift(months[i]!);
      else break;
    }
    if (tail.length < minMonths) continue;

    const values = tail.map((m) => toCents(byMonth.get(m)!.amount));
    const typical = median(values);
    // Valores muito diferentes entre si não são assinatura; são a mesma loja
    // cobrando coisas diferentes.
    const spread = Math.max(...values) - Math.min(...values);
    if (typical > 0 && spread > typical * 0.25) continue;

    const days = tail.map((m) => Number(byMonth.get(m)!.date.slice(8, 10)));
    const dayCounts = new Map<number, number>();
    for (const d of days) dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
    const expectedDay =
      [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const newest = byMonth.get(tail[tail.length - 1]!)!;
    candidates.push({
      merchantNormalized: merchant,
      description: newest.merchantAlias ?? newest.description,
      amountCents: typical,
      months: tail,
      expectedDay,
      categoryId: newest.categoryId,
      cardId: newest.cardId,
    });
  }

  return candidates.sort((a, b) => b.amountCents - a.amountCents);
}

// --------------------------------------------------------------------------
// Previsão (secao 11)
// --------------------------------------------------------------------------

export interface ForecastMonth {
  month: MonthKey;
  /** Parcelas já lançadas que caem neste mês. Compromisso, não estimativa. */
  committedCents: Cents;
  /** Recorrências ativas. Expectativa firme, mas ainda expectativa. */
  recurringCents: Cents;
  /** Média do gasto variável dos meses observados. Isto é chute. */
  estimatedCents: Cents;
  totalCents: Cents;
  /** Falso quando não houve histórico suficiente para estimar o variável. */
  hasEstimate: boolean;
}

export interface ForecastInput {
  transactions: readonly Transaction[];
  recurrences: readonly Recurrence[];
  fromMonth: MonthKey;
  months?: number;
  /** Meses de histórico usados para a média do gasto variável. */
  historyMonths?: number;
}

/**
 * Projeta os próximos meses (secao 11).
 *
 * A separação entre comprometido, recorrente e estimado é o ponto do
 * exercício. Um número único de "previsão" esconderia que a maior parte dele
 * pode ser chute, e a secao 20 proíbe exibir estimativa com cara de fato.
 */
export function forecastMonths({
  transactions,
  recurrences,
  fromMonth,
  months = 3,
  historyMonths = 3,
}: ForecastInput): ForecastMonth[] {
  const series = installmentSeries(transactions, fromMonth);
  const activeRecurring = recurrences.filter((r) => r.isActive);
  const recurringCents = activeRecurring.reduce(
    (sum, r) => sum + toCents(r.amount),
    0,
  );

  // Gasto variável do passado: tudo que não é parcela nem recorrência
  // reconhecida. É o que sobra depois de tirar o que já sabemos prever.
  const recurringKeys = new Set(
    activeRecurring.map((r) => compareKey(r.merchant ?? r.description)),
  );
  const variableByMonth = new Map<MonthKey, Cents>();

  for (const t of transactions) {
    if (t.isHidden || t.installment !== null) continue;
    if (t.status === "cancelled" || t.status === "missing") continue;
    const spend = spendingCents(t);
    if (spend <= 0) continue;

    const key = compareKey(
      t.merchantNormalized ?? t.merchantOriginal ?? t.description,
    );
    const isRecurring = [...recurringKeys].some(
      (r) => r !== "" && (key.includes(r) || r.includes(key)),
    );
    if (isRecurring) continue;

    const ahead = monthDiff(t.invoiceMonth, fromMonth);
    // Só o passado recente entra na média; meses antigos demais descrevem
    // outra fase da vida do casal.
    if (ahead < 0 || ahead >= historyMonths) continue;
    variableByMonth.set(
      t.invoiceMonth,
      (variableByMonth.get(t.invoiceMonth) ?? 0) + spend,
    );
  }

  const observed = [...variableByMonth.values()];
  const hasEstimate = observed.length >= 2;
  const estimatedCents = hasEstimate
    ? Math.round(observed.reduce((a, b) => a + b, 0) / observed.length)
    : 0;

  return Array.from({ length: months }, (_, i) => {
    const month = addMonths(fromMonth, i + 1);
    const committedCents = installmentsDueIn(series, month);
    return {
      month,
      committedCents,
      recurringCents,
      estimatedCents,
      totalCents: committedCents + recurringCents + estimatedCents,
      hasEstimate,
    };
  });
}
