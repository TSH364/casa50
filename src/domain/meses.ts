import type { Cents } from "@/lib/money";
import { toCents } from "@/lib/money";
import { incomeCents, spendingCents } from "./finance";
import { forecastMonths, installmentSeries } from "./forecast";
import { merchantCompareKey } from "./merchants";
import { addMonths, monthDiff } from "./month";
import { naoLancadas, projetar, type MesProjetado } from "./projecao";
import type { MonthKey, Recurrence, Transaction } from "./types";

/**
 * Mes a mes: o que entra e o que sai em cada mes, item por item.
 *
 * Os totais sao os da Projecao (`projetar`), a mesma conta da Analise; esta
 * funcao so abre cada total nas linhas que o formam. Nos meses que ja
 * aconteceram, as linhas sao os lancamentos; nos que vem, sao as parcelas que
 * vao cair (com o numero de cada uma), as contas fixas e a media do gasto do
 * dia a dia - e a media e marcada como estimativa, nunca como fato.
 *
 * O que sai e sempre separado do mesmo jeito - parcelas, contas fixas, dia a
 * dia -, no passado e no futuro, para o grafico comparar meses comparaveis.
 * Se as linhas nao fecharem com o total (um lancamento de um tipo que esta
 * conta nao separa), a diferenca vira uma linha "Outros": o total do mes
 * nunca muda por causa do detalhe.
 */

export interface LinhaDoMes {
  descricao: string;
  cents: Cents;
  /** "3/10", "todo mês", "média dos últimos meses". */
  detalhe: string | null;
  /** Ainda nao aconteceu: expectativa ou estimativa. */
  previsto: boolean;
}

export interface DetalheDoMes extends MesProjetado {
  entradas: LinhaDoMes[];
  parcelas: LinhaDoMes[];
  fixas: LinhaDoMes[];
  diaADia: LinhaDoMes[];
  /** As tres partes do gasto; somam `gastosCents`. */
  parcelasCents: Cents;
  fixasCents: Cents;
  diaADiaCents: Cents;
  /** Quanto do gasto ainda nao aconteceu (o grafico desenha tracejado). */
  gastoPrevistoCents: Cents;
}

const REALIZADO = new Set(["confirmed", "divergent"]);
const realizado = (t: Transaction, mes: MonthKey) => t.invoiceMonth === mes && REALIZADO.has(t.status);
const soma = (linhas: readonly LinhaDoMes[]) => linhas.reduce((s, l) => s + l.cents, 0);

/** Junta as linhas de mesmo nome (duas compras na mesma loja), da maior para a menor. */
function agrupar(linhas: readonly LinhaDoMes[]): LinhaDoMes[] {
  const por = new Map<string, LinhaDoMes>();
  for (const l of linhas) {
    const chave = `${l.descricao}|${l.detalhe ?? ""}|${l.previsto}`;
    const atual = por.get(chave);
    if (atual) atual.cents += l.cents;
    else por.set(chave, { ...l });
  }
  return [...por.values()].filter((l) => l.cents !== 0).sort((a, b) => b.cents - a.cents);
}

/** Acrescenta "Outros" quando as linhas nao fecham com o total. */
function fechar(linhas: LinhaDoMes[], total: Cents, previsto: boolean): LinhaDoMes[] {
  const dif = total - soma(linhas);
  return dif === 0 ? linhas : [...linhas, { descricao: "Outros", cents: dif, detalhe: null, previsto }];
}

const nome = (t: Transaction) => t.merchantAlias ?? t.description;

export function detalharMeses({
  transactions,
  futuras,
  recurrences,
  categorias,
  mesAtual,
  passados = 3,
  futuros = 8,
}: {
  /** Historico ate o mes atual (inclusive). */
  transactions: readonly Transaction[];
  /** Lancamentos de meses depois do atual. */
  futuras: readonly Transaction[];
  recurrences: readonly Recurrence[];
  categorias: readonly { id: string; name: string }[];
  mesAtual: MonthKey;
  passados?: number;
  futuros?: number;
}): DetalheDoMes[] {
  const projecao = projetar({ transactions, futuras, recurrences, mesAtual, passados, futuros });
  const todas = [...transactions, ...futuras];
  const nomeDaCategoria = new Map(categorias.map((c) => [c.id, c.name]));
  const ativas = recurrences.filter((r) => r.isActive);
  const chavesFixas = ativas
    .map((r) => merchantCompareKey(r.merchant ?? r.description))
    .filter((k): k is string => k !== null);
  const ehFixa = (t: Transaction) => {
    if (t.recurringId) return true;
    const k = merchantCompareKey(t.merchantNormalized ?? t.merchantOriginal ?? t.description);
    return k !== null && chavesFixas.some((r) => k.includes(r) || r.includes(k));
  };

  // A previsao de gastos e as parcelas, a partir do mes passado - como `projetar`.
  const referencia = addMonths(mesAtual, -1);
  const previsaoDe = new Map(
    forecastMonths({ transactions, recurrences, fromMonth: referencia, months: futuros + 1 }).map((f) => [f.month, f]),
  );
  const series = installmentSeries(transactions, referencia).filter((s) => !s.isFinished);

  return projecao.meses.map((m) => {
    const doMes = todas.filter((t) => realizado(t, m.month));

    // ---------------------------------------------------------- entradas
    const lancadas = agrupar(
      doMes
        .filter((t) => incomeCents(t) > 0)
        .map((t) => ({ descricao: nome(t), cents: incomeCents(t), detalhe: null, previsto: false })),
    );
    const esperadas =
      m.tipo === "realizado"
        ? []
        : naoLancadas(projecao.receitas, todas.filter((t) => t.invoiceMonth === m.month)).map((r) => ({
            descricao: r.descricao,
            cents: r.cents,
            detalhe: "todo mês",
            previsto: true,
          }));
    const entradas = fechar([...lancadas, ...esperadas], m.receitasCents, m.tipo !== "realizado");

    // ---------------------------------------------------------- o que saiu
    const parcelasFeitas: LinhaDoMes[] = [];
    const fixasFeitas: LinhaDoMes[] = [];
    const diaADiaFeito: LinhaDoMes[] = [];
    for (const t of doMes) {
      const cents = spendingCents(t);
      if (cents === 0) continue;
      if (t.installment !== null) {
        parcelasFeitas.push({ descricao: nome(t), cents, detalhe: `${t.installment.current}/${t.installment.total}`, previsto: false });
      } else if (ehFixa(t)) {
        fixasFeitas.push({ descricao: nome(t), cents, detalhe: null, previsto: false });
      } else {
        const cat = t.categoryId ? (nomeDaCategoria.get(t.categoryId) ?? "Sem categoria") : "Sem categoria";
        diaADiaFeito.push({ descricao: cat, cents, detalhe: null, previsto: false });
      }
    }

    let parcelas = agrupar(parcelasFeitas);
    let fixas = agrupar(fixasFeitas);
    let diaADia = agrupar(diaADiaFeito);
    const gastoFeito = soma(parcelas) + soma(fixas) + soma(diaADia);

    if (m.tipo === "previsto") {
      // O que vai cair: parcelas pelo numero, contas fixas, e a media do dia a dia.
      const f = previsaoDe.get(m.month);
      parcelas = agrupar([
        ...parcelas,
        ...series.flatMap((s) => {
          const adiante = monthDiff(s.latestMonth, m.month);
          if (adiante < 1 || adiante > s.remainingCount) return [];
          return [{ descricao: s.description, cents: s.installmentCents, detalhe: `${s.paidCount + adiante}/${s.totalCount}`, previsto: true }];
        }),
      ]);
      fixas = agrupar([
        ...fixas,
        ...ativas.map((r) => ({ descricao: r.description, cents: toCents(r.amount), detalhe: "todo mês", previsto: true })),
      ]);
      if (f && f.hasEstimate && f.estimatedCents > 0) {
        diaADia = [...diaADia, { descricao: "Gasto do dia a dia", cents: f.estimatedCents, detalhe: "média dos últimos meses", previsto: true }];
      }
      // A projecao usa o maior entre o lancado e o previsto: o que faltar, fecha aqui.
      diaADia = fechar(diaADia, m.gastosCents - soma(parcelas) - soma(fixas), true);
    } else if (m.tipo === "atual") {
      // O mes ainda corre: o que falta sair ate o fim e estimativa.
      const falta = m.gastosCents - gastoFeito;
      if (falta > 0) {
        diaADia = [...diaADia, { descricao: "Ainda deve sair até o fim do mês", cents: falta, detalhe: "estimativa", previsto: true }];
      }
      diaADia = fechar(diaADia, m.gastosCents - soma(parcelas) - soma(fixas), false);
    } else {
      diaADia = fechar(diaADia, m.gastosCents - soma(parcelas) - soma(fixas), false);
    }

    const parcelasCents = soma(parcelas);
    const fixasCents = soma(fixas);
    const diaADiaCents = soma(diaADia);
    const gastoPrevistoCents = [...parcelas, ...fixas, ...diaADia].filter((l) => l.previsto).reduce((s, l) => s + l.cents, 0);

    return {
      ...m,
      entradas,
      parcelas,
      fixas,
      diaADia,
      parcelasCents,
      fixasCents,
      diaADiaCents,
      gastoPrevistoCents,
    };
  });
}
