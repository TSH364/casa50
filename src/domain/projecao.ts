import type { Cents } from "@/lib/money";
import { forecastMonths } from "./forecast";
import { incomeCents, summarizeMonth } from "./finance";
import { merchantCompareKey } from "./merchants";
import { addMonths, monthDiff } from "./month";
import type { MonthKey, Recurrence, Transaction } from "./types";

/**
 * Projecao: o que entra, o que sai e quanto sobra, mes a mes - os meses que
 * ja aconteceram (consolidado) e os proximos (previsto).
 *
 * GASTOS previstos vem da previsao que ja existe (`forecastMonths`: parcelas,
 * contas fixas e a media do variavel). RECEITAS previstas sao duas coisas:
 *
 *   - o que a casa ja lancou com data futura (13o, freela combinado);
 *   - as receitas que se repetem: mesmo nome em ao menos 2 dos ultimos 3
 *     meses (a bolsa, o salario). Valor = mediana desses meses.
 *
 * Uma receita recorrente que ja foi lancada naquele mes nao conta de novo.
 * Nada e chute de receita: sem repeticao, sem lancamento, nao entra.
 */

/** Meses de historico para reconhecer uma receita que se repete. */
export const JANELA_RECEITA = 3;
/** Em quantos desses meses ela precisa aparecer. */
export const MINIMO_REPETICOES = 2;

export interface ReceitaRecorrente {
  chave: string;
  descricao: string;
  cents: Cents;
  /** Em quantos dos ultimos `JANELA_RECEITA` meses apareceu. */
  vezes: number;
}

function chaveDe(t: Transaction): string | null {
  return merchantCompareKey(t.merchantAlias ?? t.description);
}

function conta(t: Transaction): boolean {
  return !t.isHidden && t.status !== "cancelled" && t.status !== "missing";
}

function mediana(v: readonly number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/** As receitas que se repetem nos meses antes de `mesAtual`. */
export function receitasRecorrentes(transactions: readonly Transaction[], mesAtual: MonthKey): ReceitaRecorrente[] {
  // chave -> mes -> soma; e o ultimo nome visto, para mostrar.
  const porChave = new Map<string, { nome: string; meses: Map<MonthKey, Cents> }>();
  for (const t of transactions) {
    if (t.type !== "income" || !conta(t)) continue;
    const d = monthDiff(t.invoiceMonth, mesAtual);
    if (d < 1 || d > JANELA_RECEITA) continue;
    const chave = chaveDe(t);
    if (!chave) continue;
    const item = porChave.get(chave) ?? { nome: t.merchantAlias ?? t.description, meses: new Map() };
    item.meses.set(t.invoiceMonth, (item.meses.get(t.invoiceMonth) ?? 0) + incomeCents(t));
    porChave.set(chave, item);
  }
  return [...porChave.entries()]
    .filter(([, v]) => v.meses.size >= MINIMO_REPETICOES)
    .map(([chave, v]) => ({ chave, descricao: v.nome, cents: mediana([...v.meses.values()]), vezes: v.meses.size }))
    .sort((a, b) => b.cents - a.cents);
}

export type TipoDoMes = "realizado" | "atual" | "previsto";

export interface MesProjetado {
  month: MonthKey;
  tipo: TipoDoMes;
  receitasCents: Cents;
  gastosCents: Cents;
  /** Receitas - gastos. Negativo: faltou (ou vai faltar). */
  sobraCents: Cents;
  /** Soma das sobras do mes atual ate este. `null` nos meses passados. */
  acumuladoCents: Cents | null;
  /** Previsto: quanto das receitas vem de recorrencia (o resto foi lancado). */
  receitasRecorrentesCents: Cents;
  /** Previsto: o gasto variavel e media (chute), nao compromisso. */
  temEstimativa: boolean;
}

export interface Projecao {
  meses: MesProjetado[];
  receitas: ReceitaRecorrente[];
  /** Soma das sobras do mes atual ao ultimo previsto. */
  sobraNoPeriodoCents: Cents;
  /** O mes previsto (ou o atual) em que mais sobra. */
  melhorMes: MonthKey | null;
}

export interface ProjecaoInput {
  /** Historico ate o mes atual (inclusive). */
  transactions: readonly Transaction[];
  /** Lancamentos com mes depois do atual (receitas lancadas com data futura). */
  futuras: readonly Transaction[];
  recurrences: readonly Recurrence[];
  mesAtual: MonthKey;
  passados?: number;
  futuros?: number;
}

export function projetar({
  transactions,
  futuras,
  recurrences,
  mesAtual,
  passados = 3,
  futuros = 6,
}: ProjecaoInput): Projecao {
  const receitas = receitasRecorrentes(transactions, mesAtual);
  // A previsao de gastos a partir do mes passado: o primeiro mes dela e o atual.
  const previsao = forecastMonths({
    transactions,
    recurrences,
    fromMonth: addMonths(mesAtual, -1),
    months: futuros + 1,
  });
  const previsaoDe = new Map(previsao.map((f) => [f.month, f]));
  const todas = [...transactions, ...futuras];

  /**
   * Receitas recorrentes que ainda nao apareceram naquele mes.
   *
   * Apareceu = um lancamento do mes com o mesmo nome OU, sem nome igual, de
   * valor parecido (ate 10%) que nenhuma outra recorrente ja usou. A casa
   * escreve o mesmo dinheiro de jeitos diferentes ("MCAA Dividendos" num mes,
   * "MCAA" no outro); so pelo nome, os dividendos contariam duas vezes.
   */
  const recorrentesFaltando = (mes: MonthKey): Cents => {
    const lancadas = todas
      .filter((t) => t.type === "income" && conta(t) && t.invoiceMonth === mes)
      .map((t) => ({ chave: chaveDe(t), cents: incomeCents(t), usada: false }));
    let faltando = 0;
    const semNome: ReceitaRecorrente[] = [];
    for (const r of receitas) {
      const mesmoNome = lancadas.filter((l) => l.chave === r.chave);
      if (mesmoNome.length > 0) mesmoNome.forEach((l) => (l.usada = true));
      else semNome.push(r);
    }
    for (const r of semNome) {
      const parecida = lancadas.find((l) => !l.usada && Math.abs(l.cents - r.cents) <= r.cents * 0.1);
      if (parecida) parecida.usada = true;
      else faltando += r.cents;
    }
    return faltando;
  };

  const meses: MesProjetado[] = [];
  let acumulado = 0;
  for (let i = -passados; i <= futuros; i += 1) {
    const month = addMonths(mesAtual, i);
    const tipo: TipoDoMes = i < 0 ? "realizado" : i === 0 ? "atual" : "previsto";
    const resumo = summarizeMonth(todas, month);
    let receitasCents = resumo.incomeCents;
    let gastosCents = resumo.spentCents;
    let receitasRecorrentesCents = 0;
    let temEstimativa = false;
    if (tipo !== "realizado") {
      const f = previsaoDe.get(month);
      // O mes atual ja tem gasto lancado: fica o maior entre o que ja saiu e
      // o que se espera para o mes inteiro.
      gastosCents = Math.max(gastosCents, f?.totalCents ?? 0);
      temEstimativa = f?.hasEstimate ?? false;
      receitasRecorrentesCents = recorrentesFaltando(month);
      receitasCents += receitasRecorrentesCents;
    }
    const sobraCents = receitasCents - gastosCents;
    if (tipo !== "realizado") acumulado += sobraCents;
    meses.push({
      month,
      tipo,
      receitasCents,
      gastosCents,
      sobraCents,
      acumuladoCents: tipo === "realizado" ? null : acumulado,
      receitasRecorrentesCents,
      temEstimativa,
    });
  }

  const adiante = meses.filter((m) => m.tipo !== "realizado");
  const melhor = adiante.reduce<MesProjetado | null>((a, b) => (a === null || b.sobraCents > a.sobraCents ? b : a), null);
  return {
    meses,
    receitas,
    sobraNoPeriodoCents: acumulado,
    melhorMes: melhor && melhor.sobraCents > 0 ? melhor.month : null,
  };
}

// ---------------------------------------------------------------------------
// Quando comprar (Radar)
// ---------------------------------------------------------------------------

export interface ItemParaComprar {
  id: string;
  nome: string;
  cents: Cents;
}

export interface QuandoComprar {
  item: ItemParaComprar;
  /** O primeiro mes em que a sobra acumulada cobre o item. `null`: nao cabe no periodo. */
  mes: MonthKey | null;
  /** O que sobra acumulado nesse mes antes da compra. */
  disponivelCents: Cents;
}

/**
 * Em que mes cada item do Radar cabe na sobra.
 *
 * Do mais barato ao mais caro, cada compra gasta a sobra acumulada ate ali:
 * a air fryer comprada em novembro nao deixa o mesmo dinheiro livre para a
 * cadeira em novembro. A ordem e a mais barata primeiro porque libera mais
 * itens mais cedo; a casa decide se quer outra.
 */
export function quandoComprar(meses: readonly MesProjetado[], itens: readonly ItemParaComprar[]): QuandoComprar[] {
  const adiante = meses.filter((m) => m.tipo !== "realizado");
  const pendentes = [...itens].filter((i) => i.cents > 0).sort((a, b) => a.cents - b.cents);
  const resultado = new Map<string, QuandoComprar>();
  let caixa = 0;
  for (const m of adiante) {
    caixa += m.sobraCents;
    for (const item of [...pendentes]) {
      if (caixa < item.cents) break;
      resultado.set(item.id, { item, mes: m.month, disponivelCents: caixa });
      caixa -= item.cents;
      pendentes.splice(pendentes.indexOf(item), 1);
    }
  }
  for (const item of pendentes) resultado.set(item.id, { item, mes: null, disponivelCents: Math.max(0, caixa) });
  return itens.filter((i) => resultado.has(i.id)).map((i) => resultado.get(i.id)!);
}
