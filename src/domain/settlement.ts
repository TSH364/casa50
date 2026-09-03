import type { MonthKey, Transaction } from "./types";
import type { Cents } from "@/lib/money";
import { spendingCents } from "./finance";

/**
 * Divisão de despesas e acerto do mês (secao 15).
 *
 * O cálculo responde uma pergunta só: quem pagou mais do que devia, e quanto
 * precisa voltar para empatar. Três decisões sustentam isso:
 *
 * 1. **Só entra o que é da casa.** Lançamento marcado como individual é
 *    assunto de quem gastou e nunca aparece na conta do outro.
 * 2. **Lançamento sem responsável fica de fora, e é reportado.** Atribuir ao
 *    acaso produziria um acerto errado com cara de exato; o casal precisa
 *    saber que existe valor não atribuído antes de pagar qualquer coisa.
 * 3. **Estorno abate.** `spendingCents` já devolve negativo para estorno, e a
 *    soma respeita isso — quem foi estornado pagou menos, não mais.
 */

export interface MemberBalance {
  memberId: string;
  /** Quanto essa pessoa efetivamente pagou de despesas compartilhadas. */
  paidCents: Cents;
  /** Quanto caberia a ela pela regra de divisão. */
  shareCents: Cents;
  /** Positivo: pagou além da parte e tem a receber. Negativo: deve. */
  balanceCents: Cents;
}

export interface SettlementTransfer {
  fromMemberId: string;
  toMemberId: string;
  amountCents: Cents;
}

export interface MonthSettlement {
  month: MonthKey;
  /** Total compartilhado que entrou na divisão. */
  sharedCents: Cents;
  balances: MemberBalance[];
  /** Quem paga quem para zerar. Vazio quando já está empatado. */
  transfers: SettlementTransfer[];
  /**
   * Despesa compartilhada sem responsável definido. Fica fora da divisão e
   * é exibida como pendência - não como se não existisse.
   */
  unassignedCents: Cents;
  unassignedCount: number;
  isBalanced: boolean;
}

export interface SettlementOptions {
  /**
   * Peso de cada pessoa na divisão. Ausente = todos iguais.
   * Usado para divisão proporcional à renda.
   */
  weights?: Record<string, number>;
}

/**
 * Distribui um total entre pesos sem perder centavo.
 *
 * Divisão simples deixaria sobra: R$ 10,00 entre 3 dá 333 + 333 + 333 = 999.
 * O resto é distribuído um centavo por vez, dos maiores restos para os
 * menores, para a soma das partes bater exatamente com o total.
 */
function splitCents(
  totalCents: Cents,
  memberIds: readonly string[],
  weights: Record<string, number>,
): Map<string, Cents> {
  const result = new Map<string, Cents>();
  if (memberIds.length === 0) return result;

  const totalWeight = memberIds.reduce(
    (sum, id) => sum + (weights[id] ?? 1),
    0,
  );
  if (totalWeight <= 0) {
    for (const id of memberIds) result.set(id, 0);
    return result;
  }

  const exact = memberIds.map((id) => ({
    id,
    value: (totalCents * (weights[id] ?? 1)) / totalWeight,
  }));

  let distributed = 0;
  for (const item of exact) {
    const floor = Math.floor(item.value);
    result.set(item.id, floor);
    distributed += floor;
  }

  const leftover = totalCents - distributed;
  const byRemainder = [...exact].sort(
    (a, b) => (b.value % 1) - (a.value % 1),
  );
  for (let i = 0; i < leftover; i += 1) {
    const target = byRemainder[i % byRemainder.length]!;
    result.set(target.id, (result.get(target.id) ?? 0) + 1);
  }

  return result;
}

/**
 * Reduz os saldos a um conjunto mínimo de transferências.
 *
 * Para duas pessoas é trivial, mas o algoritmo vale para mais: casa o maior
 * credor com o maior devedor até zerar. Evita "A paga B, B paga C, C paga A".
 */
function settleBalances(
  balances: readonly MemberBalance[],
): SettlementTransfer[] {
  const creditors = balances
    .filter((b) => b.balanceCents > 0)
    .map((b) => ({ id: b.memberId, amount: b.balanceCents }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .filter((b) => b.balanceCents < 0)
    .map((b) => ({ id: b.memberId, amount: -b.balanceCents }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: SettlementTransfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]!;
    const creditor = creditors[j]!;
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0) {
      transfers.push({
        fromMemberId: debtor.id,
        toMemberId: creditor.id,
        amountCents: amount,
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) i += 1;
    if (creditor.amount === 0) j += 1;
  }

  return transfers;
}

export function monthSettlement(
  transactions: readonly Transaction[],
  memberIds: readonly string[],
  month: MonthKey,
  options: SettlementOptions = {},
): MonthSettlement {
  const paid = new Map<string, Cents>(memberIds.map((id) => [id, 0]));
  let sharedCents = 0;
  let unassignedCents = 0;
  let unassignedCount = 0;

  for (const t of transactions) {
    if (t.invoiceMonth !== month) continue;
    if (t.isHidden) continue;
    if (t.status === "cancelled" || t.status === "missing") continue;
    // Individual é de quem gastou: não divide, não aparece para o outro.
    if (t.visibility !== "shared") continue;

    const spend = spendingCents(t);
    if (spend === 0) continue;

    if (t.memberId === null || !paid.has(t.memberId)) {
      unassignedCents += spend;
      unassignedCount += 1;
      continue;
    }

    sharedCents += spend;
    paid.set(t.memberId, (paid.get(t.memberId) ?? 0) + spend);
  }

  const shares = splitCents(sharedCents, memberIds, options.weights ?? {});

  const balances: MemberBalance[] = memberIds.map((id) => {
    const paidCents = paid.get(id) ?? 0;
    const shareCents = shares.get(id) ?? 0;
    return {
      memberId: id,
      paidCents,
      shareCents,
      balanceCents: paidCents - shareCents,
    };
  });

  const transfers = settleBalances(balances);

  return {
    month,
    sharedCents,
    balances,
    transfers,
    unassignedCents,
    unassignedCount,
    isBalanced: transfers.length === 0,
  };
}
