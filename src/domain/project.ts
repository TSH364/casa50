import { toCents, type Cents } from "@/lib/money";
import { priorityRank, type PaymentMethod } from "./purchase";
import type { IsoDate, MonthKey } from "./types";

/**
 * Obra: o que foi comprado, o que nao foi, o que foi comprado pela metade.
 *
 * A pergunta que originou o modulo: "estou em obra e recebendo varios
 * orcamentos, pagando varias coisas, precisava ter esse controle do que foi
 * comprado, do que nao foi, do que comprei parcial".
 *
 * A DECISAO QUE DESENHA ESTE ARQUIVO: parcial e de QUANTIDADE, nao de
 * dinheiro. "Precisava de 60 m2 e comprei 40" - e nao "dei sinal de metade".
 * Por isso a compra e um registro proprio com quantidade, e nao apenas um
 * lancamento de cartao: um lancamento sozinho nao sabe dizer 40 de 60.
 *
 * NADA AQUI E GUARDADO. Quantidade comprada, valor gasto e status saem da
 * soma das compras a cada leitura. Guardar um resumo ao lado do historico
 * abre espaco para os dois divergirem, e status digitado a mao mente calado -
 * a mesma razao pela qual `goals` nao guarda `current_amount`.
 */

export type ItemStatus =
  /** Nenhuma compra registrada. */
  | "nao_comprado"
  /** Comprou parte: ou da quantidade, ou do valor quando nao ha quantidade. */
  | "parcial"
  /** Fechou: a quantidade prevista foi atingida, ou a casa deu por encerrado. */
  | "comprado";

export interface ProjectQuote {
  id: string;
  supplier: string;
  amountCents: Cents;
  /** Quantidade que ESTA proposta cobre, quando difere da prevista. */
  quantity: number | null;
  isChosen: boolean;
  note: string | null;
  quotedOn: IsoDate | null;
}

export interface ProjectPurchase {
  id: string;
  quantity: number | null;
  /** A compra INTEIRA, e nao a parcela do mes - ver `domain/purchase.ts`. */
  amountCents: Cents;
  date: IsoDate;
  supplier: string | null;
  /** Lancamento correspondente, quando a compra passou pelo cartao. */
  transactionId: string | null;
  paymentMethod: PaymentMethod | null;
  /** Mes em que a despesa cai. Nulo = o mes da data da compra. */
  invoiceMonth: MonthKey | null;
  /** Em quantas vezes. Nulo = a vista. */
  installmentTotal: number | null;
}

export interface ProjectItem {
  id: string;
  stage: string | null;
  name: string;
  unit: string | null;
  plannedQuantity: number | null;
  note: string | null;
  sortOrder: number;
  /** 1 alta, 2 media, 3 baixa. Nulo = a casa ainda nao decidiu. */
  priority: number | null;
  /** Quando a casa deu o item por encerrado, mesmo sem fechar a quantidade. */
  closedAt: string | null;
  quotes: ProjectQuote[];
  purchases: ProjectPurchase[];
}

export interface ItemProgress {
  item: ProjectItem;
  status: ItemStatus;
  /** Proposta escolhida, ou `null` enquanto a casa nao decidiu. */
  chosen: ProjectQuote | null;
  /**
   * Quanto o item deve custar. Vem da cotacao escolhida; sem escolha, da
   * MENOR recebida - que e a leitura honesta de "quanto isto sai" antes de
   * decidir, e nunca esconde que ainda nao ha decisao (`chosen` diz isso).
   */
  expectedCents: Cents | null;
  spentCents: Cents;
  /** Quanto falta pagar. Zero quando ja passou do previsto. */
  remainingCents: Cents;
  /** Positivo quando o item ja custou mais que o previsto. */
  overCents: Cents;
  boughtQuantity: number | null;
  /** 0 a 1 pela QUANTIDADE quando ha quantidade prevista; senao pelo valor. */
  ratio: number;
  /** Quantas propostas ainda esperam decisao. */
  quoteCount: number;
}

/** Soma em centavos, para nao repetir o reduce em cinco lugares. */
function soma(values: readonly Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * O estado de um item, deduzido do que foi registrado nele.
 *
 * A ORDEM DAS REGRAS IMPORTA e cada uma existe por um motivo:
 *
 *   - encerrado a mao vence tudo. Sobra de material, troca de escopo e
 *     desconto no fim da obra sao normais, e um item que nunca fecha sozinho
 *     viraria ruido permanente na lista;
 *   - com quantidade prevista, quem manda e a QUANTIDADE. Foi a escolha de
 *     quem vai usar, e e a unica leitura que responde "comprei 40 de 60";
 *   - sem quantidade prevista - "mao de obra eletrica", "verba" - nao ha o que
 *     contar, e ai o dinheiro responde. Um item de verba com metade paga esta
 *     pela metade, e chama-lo de "nao comprado" seria mentir.
 */
export function itemProgress(item: ProjectItem): ItemProgress {
  const chosen = item.quotes.find((q) => q.isChosen) ?? null;
  const menor = item.quotes.length
    ? item.quotes.reduce((a, b) => (b.amountCents < a.amountCents ? b : a))
    : null;
  const expectedCents = chosen?.amountCents ?? menor?.amountCents ?? null;

  const spentCents = soma(item.purchases.map((p) => p.amountCents));

  // `null` e nao-zero de proposito: "nenhuma compra tem quantidade" e
  // diferente de "comprei zero", e a tela precisa poder calar em vez de
  // escrever "0 m2 de 60" num item que ninguem mediu ainda.
  const comQuantidade = item.purchases.filter((p) => p.quantity !== null);
  const boughtQuantity = comQuantidade.length
    ? comQuantidade.reduce((s, p) => s + (p.quantity ?? 0), 0)
    : null;

  const prevista = item.plannedQuantity;
  const porQuantidade = prevista !== null && prevista > 0;

  const ratio = porQuantidade
    ? Math.min(1, (boughtQuantity ?? 0) / prevista)
    : expectedCents && expectedCents > 0
      ? Math.min(1, spentCents / expectedCents)
      : 0;

  let status: ItemStatus;
  if (item.closedAt !== null) {
    status = "comprado";
  } else if (item.purchases.length === 0) {
    status = "nao_comprado";
  } else if (porQuantidade) {
    // Tolerancia de meio por mil para o 59,999 nao ficar eternamente parcial:
    // quantidade de obra vem de conta de area, e o arredondamento e do mundo.
    status = (boughtQuantity ?? 0) >= prevista - 0.0005 ? "comprado" : "parcial";
    } else {
    status =
      expectedCents !== null && expectedCents > 0 && spentCents >= expectedCents
        ? "comprado"
        : "parcial";
  }

  return {
    item,
    status,
    chosen,
    expectedCents,
    spentCents,
    remainingCents: Math.max(0, (expectedCents ?? 0) - spentCents),
    overCents:
      expectedCents === null ? 0 : Math.max(0, spentCents - expectedCents),
    boughtQuantity,
    ratio,
    quoteCount: item.quotes.length,
  };
}

export interface ProjectSummary {
  items: ItemProgress[];
  /** Soma do previsto. Itens sem cotacao nenhuma nao entram - ver abaixo. */
  expectedCents: Cents;
  spentCents: Cents;
  remainingCents: Cents;
  /**
   * Quantos itens ainda nao tem cotacao alguma.
   *
   * Vem junto do total de proposito: sem este numero, "previsto R$ 40.000"
   * parece o custo da obra quando pode ser o custo de metade dela. Uma obra
   * comeca com itens sem preco, e o total precisa dizer de quantos ele fala.
   */
  itemsWithoutQuote: number;
  /** Itens com mais de uma proposta e nenhuma escolhida. */
  itemsAwaitingChoice: number;
  byStatus: Record<ItemStatus, number>;
}

/** O retrato da obra inteira, a partir dos itens. */
export function projectSummary(items: readonly ProjectItem[]): ProjectSummary {
  const progress = items.map(itemProgress);

  const byStatus: Record<ItemStatus, number> = {
    nao_comprado: 0,
    parcial: 0,
    comprado: 0,
  };
  for (const p of progress) byStatus[p.status] += 1;

  const expectedCents = soma(progress.map((p) => p.expectedCents ?? 0));
  const spentCents = soma(progress.map((p) => p.spentCents));

  return {
    // A PRIORIDADE VEM ANTES DA ORDEM DA PLANILHA, e depois da etapa: dentro
    // de "Revestimentos", o que a casa marcou como urgente aparece primeiro.
    // Ordenar por prioridade acima da etapa desmontaria os blocos da obra, que
    // e como se compra - tudo do piso na mesma ida a loja.
    items: progress.sort(
      (a, b) =>
        (a.item.stage ?? "").localeCompare(b.item.stage ?? "") ||
        priorityRank(a.item.priority) - priorityRank(b.item.priority) ||
        a.item.sortOrder - b.item.sortOrder ||
        a.item.name.localeCompare(b.item.name),
    ),
    expectedCents,
    spentCents,
    // Contra o PREVISTO, e nao contra o gasto: o que falta comprar e a
    // diferenca para o combinado, e um item que estourou nao gera "falta
    // negativa" que abateria o que falta nos outros.
    remainingCents: soma(progress.map((p) => p.remainingCents)),
    itemsWithoutQuote: progress.filter((p) => p.quoteCount === 0).length,
    itemsAwaitingChoice: progress.filter(
      (p) => p.quoteCount > 1 && p.chosen === null,
    ).length,
    byStatus,
  };
}

/**
 * Quanto a casa economizou (ou perdeu) ao escolher as propostas que escolheu.
 *
 * So conta item com escolha feita E mais de uma proposta: sem concorrencia
 * nao ha o que comparar, e somar item de proposta unica infla a economia com
 * zeros que nunca foram decisao de ninguem.
 *
 * Positivo = escolheu mais barato que a media das outras.
 */
export function savingsFromChoices(items: readonly ProjectItem[]): Cents {
  let total = 0;
  for (const item of items) {
    const chosen = item.quotes.find((q) => q.isChosen);
    if (!chosen || item.quotes.length < 2) continue;
    const outras = item.quotes.filter((q) => q.id !== chosen.id);
    const media = Math.round(soma(outras.map((q) => q.amountCents)) / outras.length);
    total += media - chosen.amountCents;
  }
  return total;
}

/** Agrupa por etapa, preservando a ordem ja definida em `projectSummary`. */
export function byStage(
  progress: readonly ItemProgress[],
): { stage: string | null; items: ItemProgress[] }[] {
  const grupos = new Map<string, ItemProgress[]>();
  for (const p of progress) {
    // A chave e string porque `null` e `""` sao a mesma coisa para quem le:
    // "sem etapa". O rotulo volta a ser `null` na saida.
    const chave = p.item.stage?.trim() || "";
    const lista = grupos.get(chave) ?? [];
    lista.push(p);
    grupos.set(chave, lista);
  }
  return [...grupos.entries()]
    .map(([stage, items]) => ({ stage: stage === "" ? null : stage, items }))
    // Sem etapa vai para o fim: e a caixa de entrada, nao o comeco da obra.
    .sort((a, b) =>
      a.stage === null ? 1 : b.stage === null ? -1 : a.stage.localeCompare(b.stage),
    );
}

/** Converte o valor em reais que vem do banco para centavos do dominio. */
export function quoteCents(amount: number): Cents {
  return toCents(amount);
}
