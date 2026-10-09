import { fromCents } from "@/lib/money";
import { incomeCents } from "./finance";
import { daysInMonth, monthDiff } from "./month";
import { JANELA_RECEITA, chaveDe, conta, naoLancadas, receitasRecorrentes, type ReceitaRecorrente } from "./projecao";
import type { IsoDate, MonthKey, Transaction } from "./types";

/**
 * Receitas de todo mes, prontas para lancar.
 *
 * O salario, a bolsa, o pro-labore: entram quase iguais todo mes, e digitar
 * tudo de novo e onde nasce o erro de preenchimento rapido. A casa nao
 * precisa cadastrar nada - vale a mesma regra da Projecao: mesmo nome em ao
 * menos 2 dos ultimos 3 meses. O modelo copia o ultimo lancamento dela
 * (nome, valor, categoria, quem recebeu, dia); a casa confere e confirma.
 */
export interface ModeloDeReceita extends ReceitaRecorrente {
  description: string;
  /** O valor do ultimo mes, em reais - o salario que subiu vale o novo. */
  amount: number;
  /** Dia do mes em que costuma cair. */
  dia: number;
  categoryId: string | null;
  subcategoryId: string | null;
  memberId: string | null;
  isJoint: boolean;
  visibility: Transaction["visibility"];
}

/** As receitas que se repetem nos 3 meses antes de `mes`, com o ultimo lancamento de cada uma. */
export function modelosDeReceita(transactions: readonly Transaction[], mes: MonthKey): ModeloDeReceita[] {
  const ultima = new Map<string, Transaction>();
  for (const t of transactions) {
    if (t.type !== "income" || !conta(t)) continue;
    const d = monthDiff(t.invoiceMonth, mes);
    if (d < 1 || d > JANELA_RECEITA) continue;
    const chave = chaveDe(t);
    if (!chave) continue;
    const atual = ultima.get(chave);
    if (!atual || `${t.invoiceMonth}${t.date}` > `${atual.invoiceMonth}${atual.date}`) ultima.set(chave, t);
  }
  return receitasRecorrentes(transactions, mes).flatMap((r) => {
    const t = ultima.get(r.chave);
    if (!t) return [];
    return [
      {
        ...r,
        description: t.description,
        amount: fromCents(incomeCents(t)),
        dia: Number(t.date.slice(8, 10)) || 1,
        categoryId: t.categoryId,
        subcategoryId: t.subcategoryId,
        memberId: t.memberId,
        isJoint: t.isJoint,
        visibility: t.visibility,
      },
    ];
  });
}

/** Os modelos que ainda nao foram lancados em `mes` (por nome ou valor parecido, ver `naoLancadas`). */
export function faltamNoMes(
  modelos: readonly ModeloDeReceita[],
  transactions: readonly Transaction[],
  mes: MonthKey,
): ModeloDeReceita[] {
  return naoLancadas(
    modelos,
    transactions.filter((t) => t.invoiceMonth === mes),
  );
}

/** A data do modelo dentro de `mes` - o dia 31 vira o ultimo dia de um mes mais curto. */
export function dataDoModelo(modelo: Pick<ModeloDeReceita, "dia">, mes: MonthKey): IsoDate {
  const dia = Math.min(Math.max(1, modelo.dia), daysInMonth(mes));
  return `${mes}-${String(dia).padStart(2, "0")}`;
}
