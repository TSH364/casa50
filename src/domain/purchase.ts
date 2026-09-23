import type { Cents } from "@/lib/money";
import { monthOf } from "./month";
import { merchantCompareKey } from "./merchants";
import type { IsoDate, MonthKey } from "./types";

/**
 * A compra da obra: como foi paga, a qual lancamento ela corresponde, e quanto
 * ela custou de verdade (secao 15).
 *
 * TRES DECISOES MORAM AQUI, e as tres existem porque a resposta obvia erra:
 *
 *   1. PARCELA NAO E O PRECO. Uma compra de R$ 8.965 em 10x aparece na fatura
 *      como uma linha de R$ 896,55 por mes. Vincular o item a essa linha e
 *      gravar o que ela diz faria o porcelanato da sala parecer 10% comprado
 *      para sempre - e o total da obra apontaria nove mil reais a menos do que
 *      a casa deve.
 *   2. QUEM PASSA NO CARTAO NAO GERA LANCAMENTO. A fatura ja traz. Criar um
 *      lancamento para uma compra de cartao contaria a mesma despesa duas
 *      vezes. Boleto, pix e dinheiro nao chegam por lugar nenhum, e para esses
 *      o app precisa lancar.
 *   3. O VALOR PREVISTO E O PAGO QUASE NUNCA SAO IGUAIS. Obra tem frete,
 *      desconto na loja e caixa fechada. A diferenca nao e erro: e informacao,
 *      e some se o app so gravar o numero novo em silencio.
 */

export type PaymentMethod = "card" | "boleto" | "pix" | "cash";

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "card",
  "boleto",
  "pix",
  "cash",
] as const;

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  card: "Cartão",
  boleto: "Boleto",
  pix: "Pix",
  cash: "Dinheiro",
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly unknown[]).includes(value);
}

/**
 * Esta forma de pagamento precisa que o app lance a despesa?
 *
 * So o cartao dispensa: a fatura traz. As outras nao chegam por lugar nenhum,
 * e sem o lancamento a maior parte de uma obra ficaria invisivel nos totais do
 * mes - metade dela contada, porque caiu no cartao, e metade nao.
 */
export function needsLedgerEntry(method: PaymentMethod): boolean {
  return method !== "card";
}

// ---------------------------------------------------------------------------
// O lancamento que ja existe
// ---------------------------------------------------------------------------

/** Um lancamento do cartao, como a tela de vincular precisa ver. */
export interface LinkableTransaction {
  id: string;
  date: IsoDate;
  invoiceMonth: MonthKey;
  description: string;
  merchant: string | null;
  /** O valor da LINHA da fatura - que numa compra parcelada e uma parcela. */
  amountCents: Cents;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  installmentValueCents: Cents | null;
  cardLabel: string | null;
}

export interface InstallmentPlan {
  current: number;
  total: number;
  perMonthCents: Cents;
}

export interface PurchaseFromTransaction {
  /** Quanto a COMPRA vale - a soma das parcelas, quando ha parcelas. */
  amountCents: Cents;
  /** O mes da primeira parcela: e quando a compra aconteceu. */
  invoiceMonth: MonthKey;
  installment: InstallmentPlan | null;
  /**
   * O total foi DEDUZIDO das parcelas, e nao lido de lugar nenhum.
   *
   * Vem junto de proposito: a fatura nao diz quanto custou a compra inteira,
   * ela diz quanto custa esta parcela. Multiplicar por dez e a melhor conta
   * possivel, e ainda assim e uma conta - juros e arredondamento de centavo
   * fazem a soma real diferir. A tela precisa poder dizer "deduzi" em vez de
   * afirmar.
   */
  inferredTotal: boolean;
}

/**
 * O que gravar como compra, a partir do lancamento que a pessoa escolheu.
 *
 * MEDIDO na base real: dos 658 lancamentos importados, os parcelados trazem
 * `installment_current`, `installment_total` e `installment_value` vindos da
 * propria fatura - entao a deducao do total nao depende de adivinhar quantas
 * parcelas faltam.
 */
export function purchaseFromTransaction(
  t: LinkableTransaction,
): PurchaseFromTransaction {
  const total = t.installmentTotal;
  const current = t.installmentCurrent;

  if (total === null || current === null || total <= 1) {
    return {
      amountCents: t.amountCents,
      invoiceMonth: t.invoiceMonth,
      installment: null,
      inferredTotal: false,
    };
  }

  // `installment_value` e o que a fatura diz que custa a parcela. Quando ele
  // falta - e falta em parte das faturas - o proprio valor da linha serve, que
  // e a mesma coisa vista de outro lugar.
  const porMes = t.installmentValueCents ?? t.amountCents;

  return {
    amountCents: porMes * total,
    // A compra aconteceu no mes da PRIMEIRA parcela, e nao no mes desta linha:
    // vincular a parcela 3 de 10 e dizer que a casa comprou tres meses atras.
    invoiceMonth: shiftMonth(t.invoiceMonth, -(current - 1)),
    installment: { current, total, perMonthCents: porMes },
    inferredTotal: true,
  };
}

/** Desloca meses sem passar por `Date`, que erraria de fuso na virada. */
function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const ano = Number(month.slice(0, 4));
  const i = Number(month.slice(5, 7)) - 1 + delta;
  const anoFinal = ano + Math.floor(i / 12);
  const mesFinal = ((i % 12) + 12) % 12;
  return `${anoFinal}-${String(mesFinal + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// A diferenca entre o previsto e o pago
// ---------------------------------------------------------------------------

export interface PriceGap {
  /** Positivo = pagou MAIS que o previsto. */
  diffCents: Cents;
  /** Fracao do previsto: 0.08 = oito por cento acima. */
  ratio: number;
}

/**
 * Quanto o valor real se afastou do que a casa tinha combinado.
 *
 * Devolve `null` quando nao ha o que comparar - item sem cotacao escolhida, ou
 * previsto zerado. Zero previsto com valor pago nao e "infinito por cento a
 * mais": e um item que ninguem cotou, e inventar uma porcentagem ali seria
 * alarme sem conteudo.
 */
export function priceGap(
  expectedCents: Cents | null,
  actualCents: Cents,
): PriceGap | null {
  if (expectedCents === null || expectedCents <= 0) return null;
  const diffCents = actualCents - expectedCents;
  return { diffCents, ratio: diffCents / expectedCents };
}

// ---------------------------------------------------------------------------
// Achar o lancamento certo no meio da fatura
// ---------------------------------------------------------------------------

export interface Candidate {
  transaction: LinkableTransaction;
  score: number;
}

/**
 * Poe na frente os lancamentos que tem cara de ser esta compra.
 *
 * O PROBLEMA QUE ISTO RESOLVE: a base tem centenas de lancamentos, e pedir que
 * a pessoa ache "o do porcelanato" rolando a lista e pedir que ela desista. Os
 * dois sinais que ela usaria de qualquer jeito:
 *
 *   - O FORNECEDOR. A cotacao escolhida diz de quem e, e a fatura diz onde
 *     passou. Comparados pela mesma chave que o resto do app usa para juntar
 *     "JK TINTAS" e "Jk Tintas e Pisos" - sem acento, sem caixa, sem espaco.
 *   - O VALOR. Um lancamento de R$ 8.965,50 para um item previsto em
 *     R$ 8.965,50 dificilmente e outra coisa. A comparacao e pelo valor da
 *     COMPRA (parcelas somadas), senao todo parcelamento ficaria no fim.
 *
 * A data nao entra: obra se paga meses depois de cotada, e proximidade de data
 * so empurraria para cima o que foi comprado por ultimo.
 */
export function rankCandidates(
  transactions: readonly LinkableTransaction[],
  reference: { supplier?: string | null; expectedCents?: Cents | null },
): Candidate[] {
  const alvo = (reference.supplier ? merchantCompareKey(reference.supplier) : "") ?? "";
  const previsto = reference.expectedCents ?? null;

  return transactions
    .map((transaction) => {
      const compra = purchaseFromTransaction(transaction);
      let score = 0;

      if (alvo !== "") {
        const nome =
          merchantCompareKey(transaction.merchant ?? transaction.description) ?? "";
        // `includes` nos dois sentidos porque um lado costuma ser mais longo:
        // a fatura escreve "JKTINTASEPISOSLTDA" onde a cotacao diz "JKTINTAS".
        if (nome !== "" && nome === alvo) score += 100;
        else if (nome !== "" && (nome.includes(alvo) || alvo.includes(nome))) score += 60;
      }

      if (previsto !== null && previsto > 0) {
        const gap = Math.abs(compra.amountCents - previsto) / previsto;
        if (gap < 0.001) score += 80;
        else if (gap < 0.05) score += 50;
        else if (gap < 0.2) score += 20;
      }

      return { transaction, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Empate: o mais recente primeiro, que e onde a pessoa estava olhando.
        b.transaction.date.localeCompare(a.transaction.date),
    );
}

// ---------------------------------------------------------------------------
// Prioridade
// ---------------------------------------------------------------------------

export type Priority = 1 | 2 | 3;

export const PRIORITY_LABEL: Record<Priority, string> = {
  1: "Alta",
  2: "Média",
  3: "Baixa",
};

export function isPriority(value: unknown): value is Priority {
  return value === 1 || value === 2 || value === 3;
}

/**
 * A ordem em que os itens aparecem: o urgente primeiro.
 *
 * Sem prioridade vai DEPOIS de baixa, e nao antes: um item que ninguem marcou
 * e um item sobre o qual ninguem decidiu, e por na frente o que nao foi
 * pensado empurraria para baixo justamente o que foi.
 */
export function priorityRank(priority: number | null): number {
  return priority ?? 9;
}

/** O mes em que a despesa cai, com a data da compra como reserva. */
export function purchaseMonth(purchase: {
  invoiceMonth: MonthKey | null;
  date: IsoDate;
}): MonthKey {
  return purchase.invoiceMonth ?? monthOf(purchase.date);
}
