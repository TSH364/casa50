import type { Cents } from "@/lib/money";
import { toCents } from "@/lib/money";
import type { Budget, MonthKey, Recurrence, Transaction } from "./types";
import { addMonths, monthRange } from "./month";
import { totalsByCategory } from "./finance";
import { installmentSeries, installmentsDueIn } from "./forecast";

/**
 * Equalizacao do mes (camada 3 da agenda).
 *
 * O gesto que este arquivo executa: "esse mes tem viagem, entao alimentacao
 * vai de R$ 1.000 para R$ 800". Ele nao decide nada - devolve uma PROPOSTA,
 * com o numero de origem, o numero de destino e o motivo de cada linha, para
 * o casal aceitar ou recusar por inteiro. Orcamento e combinado entre duas
 * pessoas; um app que reescreve o combinado sozinho perde a serventia.
 *
 * Tres regras impedem que a proposta seja apenas aritmetica:
 *
 * 1. **Nao se corta o que ja foi assinado.** Parcela lancada e recorrencia
 *    ativa daquele mes formam um piso: sugerir gastar menos com a parcela do
 *    sofa e sugerir nao pagar o sofa.
 * 2. **Nao se corta abaixo do que ja foi gasto.** Dia 20, com R$ 700 gastos,
 *    propor limite de R$ 500 nao e meta, e constatacao de fracasso.
 * 3. **Folga antes de dor.** Se o limite ja estava acima do que a casa
 *    costuma gastar, aquela diferenca sai primeiro - e dinheiro no papel, e
 *    devolve-lo nao muda a vida de ninguem.
 */

/** Nenhuma categoria cede mais que isto do que costuma gastar. */
const MAX_CUT = 0.4;

/** Propostas em multiplos de R$ 10: um limite decidido por gente e redondo. */
const STEP = 1_000;

export interface CategoryBudgetState {
  categoryId: string;
  /** Limite vigente no mes. */
  limitCents: Cents;
  /** Quanto ja saiu no mes. */
  spentCents: Cents;
  /** Mediana do gasto da categoria no historico. Zero quando nao ha base. */
  typicalCents: Cents;
  /** Parcelas e recorrencias que caem no mes nesta categoria. */
  committedCents: Cents;
}

export type ProposalReason =
  /** O limite estava acima do gasto habitual: sobra devolvida. */
  | "slack"
  /** Corte de verdade: a categoria vai ter que gastar menos. */
  | "cut";

export interface RebalanceProposal {
  categoryId: string;
  fromCents: Cents;
  toCents: Cents;
  freedCents: Cents;
  reason: ProposalReason;
  typicalCents: Cents;
  spentCents: Cents;
}

export type UntouchedReason =
  /** Quase tudo na categoria e compromisso assumido. */
  | "committed"
  /** Ja esta no piso: cortar mais passaria do que ja foi gasto. */
  | "at_floor";

export interface RebalancePlan {
  needCents: Cents;
  freedCents: Cents;
  /** Quanto a proposta nao conseguiu cobrir. Zero quando fechou. */
  shortfallCents: Cents;
  proposals: RebalanceProposal[];
  untouched: { categoryId: string; reason: UntouchedReason }[];
}

/**
 * Piso da categoria: abaixo disto a proposta viraria ficcao.
 *
 * O maximo entre o ja gasto, o ja assinado e 60% do habitual - limitado pelo
 * proprio limite, para uma categoria que ja esta apertada nao aparecer com
 * "piso acima do teto".
 */
function floorOf(state: CategoryBudgetState): Cents {
  const habitual =
    state.typicalCents > 0 ? state.typicalCents : state.limitCents;
  return Math.min(
    state.limitCents,
    Math.max(
      state.spentCents,
      state.committedCents,
      Math.round(habitual * (1 - MAX_CUT)),
    ),
  );
}

/** 1 = totalmente discricionaria; 0 = tudo ali ja esta comprometido. */
function flexibility(state: CategoryBudgetState): number {
  const habitual = state.typicalCents > 0 ? state.typicalCents : state.limitCents;
  if (habitual <= 0) return 0;
  return Math.max(0, 1 - Math.min(1, state.committedCents / habitual));
}

/**
 * Monta a proposta de realocacao (camada 3).
 *
 * `needCents` e quanto precisa ser liberado - tipicamente a estimativa de
 * gasto extra que a agenda aponta para o mes.
 */
export function rebalancePlan(
  states: readonly CategoryBudgetState[],
  needCents: Cents,
): RebalancePlan {
  if (needCents <= 0 || states.length === 0) {
    // Sem necessidade nao ha falta; sem orcamento cadastrado a falta e
    // inteira, e dizer isso e o ponto - a tela precisa explicar que nao ha
    // limite nenhum para realocar.
    const need = Math.max(0, needCents);
    return {
      needCents: need,
      freedCents: 0,
      shortfallCents: states.length === 0 ? need : 0,
      proposals: [],
      untouched: [],
    };
  }

  const taken = new Map<string, { slack: Cents; cut: Cents }>();
  const floors = new Map(states.map((s) => [s.categoryId, floorOf(s)]));
  let remaining = needCents;

  const takenOf = (id: string) => taken.get(id) ?? { slack: 0, cut: 0 };

  /**
   * Uma passada de corte. `boundOf` diz ate onde aquela passada pode ir: na
   * primeira, ate o gasto habitual; na segunda, ate o piso.
   */
  function pass(
    phase: ProposalReason,
    order: readonly CategoryBudgetState[],
    boundOf: (state: CategoryBudgetState) => Cents,
  ) {
    for (const state of order) {
      if (remaining <= 0) return;
      const already = takenOf(state.categoryId);
      const current = state.limitCents - already.slack - already.cut;
      const available = current - boundOf(state);
      if (available <= 0) continue;

      // Arredonda o corte PARA CIMA no passo de R$ 10: fecha a conta e deixa
      // o limite proposto redondo, do jeito que uma pessoa escreveria.
      const wanted = Math.min(available, Math.ceil(remaining / STEP) * STEP);
      const cut = Math.min(available, wanted);
      if (cut <= 0) continue;

      taken.set(state.categoryId, {
        slack: already.slack + (phase === "slack" ? cut : 0),
        cut: already.cut + (phase === "cut" ? cut : 0),
      });
      remaining -= cut;
    }
  }

  // Passada 1: so a folga - limite acima do habitual. Ordena pela maior
  // folga, porque e a que devolve mais sem custar nada.
  const slackOf = (s: CategoryBudgetState) =>
    Math.max(0, s.limitCents - Math.max(floors.get(s.categoryId)!, s.typicalCents));
  pass(
    "slack",
    [...states].sort((a, b) => slackOf(b) - slackOf(a)),
    (s) => Math.max(floors.get(s.categoryId)!, s.typicalCents),
  );

  // Passada 2: corte de verdade, da categoria mais discricionaria para a
  // menos. Concentrar no topo da lista produz "alimentacao: 1.000 -> 800", que
  // e uma decisao; espalhar produziria doze cortes de R$ 17, que nao e.
  pass(
    "cut",
    [...states].sort((a, b) => {
      const flex = flexibility(b) - flexibility(a);
      if (Math.abs(flex) > 0.01) return flex;
      return b.limitCents - floors.get(b.categoryId)! - (a.limitCents - floors.get(a.categoryId)!);
    }),
    (s) => floors.get(s.categoryId)!,
  );

  const proposals: RebalanceProposal[] = [];
  for (const state of states) {
    const { slack, cut } = takenOf(state.categoryId);
    const total = slack + cut;
    if (total <= 0) continue;

    // O limite proposto desce para o multiplo de R$ 10 abaixo, sem furar o
    // piso. Arredondar o CORTE nao bastava: com folga quebrada o limite saia
    // "R$ 843,00", que ninguem escreveria a mao. Descer libera um pouco mais
    // do que o pedido, e sobrar e o lado certo de errar.
    const toCentsValue = Math.max(
      floors.get(state.categoryId)!,
      Math.floor((state.limitCents - total) / STEP) * STEP,
    );

    proposals.push({
      categoryId: state.categoryId,
      fromCents: state.limitCents,
      toCents: toCentsValue,
      freedCents: state.limitCents - toCentsValue,
      reason: cut > 0 ? "cut" : "slack",
      typicalCents: state.typicalCents,
      spentCents: state.spentCents,
    });
  }
  proposals.sort((a, b) => b.freedCents - a.freedCents);

  const untouched = states
    .filter((s) => takenOf(s.categoryId).slack + takenOf(s.categoryId).cut === 0)
    .map((s) => ({
      categoryId: s.categoryId,
      reason: (flexibility(s) < 0.35 ? "committed" : "at_floor") as UntouchedReason,
    }));

  const freed = proposals.reduce((sum, p) => sum + p.freedCents, 0);
  return {
    needCents,
    freedCents: freed,
    shortfallCents: Math.max(0, needCents - freed),
    proposals,
    untouched,
  };
}

// --------------------------------------------------------------------------
// Entradas do plano, montadas a partir do que ja existe
// --------------------------------------------------------------------------

/**
 * Quanto de cada categoria ja esta assinado para o mes.
 *
 * Parcela lancada nao aparece no mes futuro ate a fatura chegar, entao vem da
 * projecao das series; recorrencia ativa vem do cadastro. As duas juntas sao o
 * piso intocavel da regra 1.
 */
export function committedByCategory(
  transactions: readonly Transaction[],
  recurrences: readonly Recurrence[],
  month: MonthKey,
  referenceMonth: MonthKey,
): Map<string | null, Cents> {
  const out = new Map<string | null, Cents>();
  const add = (id: string | null, cents: Cents) =>
    out.set(id, (out.get(id) ?? 0) + cents);

  const series = installmentSeries(transactions, referenceMonth);
  for (const s of series) {
    const due = installmentsDueIn([s], month);
    if (due > 0) add(s.categoryId, due);
  }

  for (const r of recurrences) {
    if (!r.isActive) continue;
    add(r.categoryId, toCents(r.amount));
  }

  return out;
}

/** Mediana do gasto de cada categoria nos meses anteriores ao analisado. */
export function typicalByCategory(
  transactions: readonly Transaction[],
  month: MonthKey,
  historyMonths = 6,
): Map<string | null, Cents> {
  const months = monthRange(addMonths(month, -historyMonths), addMonths(month, -1));
  const withData = months.filter((m) => transactions.some((t) => t.invoiceMonth === m));

  const perCategory = new Map<string | null, Cents[]>();
  for (const m of withData) {
    const totals = new Map(
      totalsByCategory(transactions, m).map((t) => [t.categoryId, t.totalCents]),
    );
    const ids = new Set([...perCategory.keys(), ...totals.keys()]);
    for (const id of ids) {
      const list = perCategory.get(id) ?? [];
      // Mes sem gasto na categoria conta zero: a casa pode simplesmente nao
      // ter gasto, e ignorar o mes inflaria a mediana.
      list.push(totals.get(id) ?? 0);
      perCategory.set(id, list);
    }
  }

  const out = new Map<string | null, Cents>();
  for (const [id, values] of perCategory) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    out.set(
      id,
      sorted.length % 2 === 0
        ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
        : (sorted[middle] ?? 0),
    );
  }
  return out;
}

/**
 * Junta orcamento, gasto, habito e compromisso numa entrada por categoria.
 *
 * Categorias sem orcamento no mes ficam de fora: nao ha limite para realocar,
 * e criar um limite novo para poder corta-lo seria inventar um combinado.
 */
export function budgetStates({
  budgets,
  transactions,
  recurrences,
  month,
  referenceMonth,
}: {
  budgets: readonly Budget[];
  transactions: readonly Transaction[];
  recurrences: readonly Recurrence[];
  month: MonthKey;
  referenceMonth: MonthKey;
}): CategoryBudgetState[] {
  const typical = typicalByCategory(transactions, month);
  const committed = committedByCategory(transactions, recurrences, month, referenceMonth);
  const spent = new Map(
    totalsByCategory(transactions, month).map((t) => [t.categoryId, t.totalCents]),
  );

  return budgets
    .filter((b) => b.month === month)
    .map((b) => ({
      categoryId: b.categoryId,
      limitCents: toCents(b.limitAmount),
      spentCents: spent.get(b.categoryId) ?? 0,
      typicalCents: typical.get(b.categoryId) ?? 0,
      committedCents: committed.get(b.categoryId) ?? 0,
    }));
}
