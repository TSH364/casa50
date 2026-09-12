import type { Cents } from "@/lib/money";
import type { IsoDate, Transaction } from "./types";
import { spendingCents } from "./finance";

/**
 * Sugestao de subcategoria a partir do comportamento (secao 14).
 *
 * A pergunta que originou isto: "meu gasto com alimentacao de segunda a sexta
 * e almoco no trabalho; no fim de semana e outra coisa - da para o app
 * separar?". Da, mas nao pelo caminho obvio.
 *
 * MEDIDO nos oito meses reais antes de escrever qualquer regra: o ticket
 * mediano de alimentacao vai de R$ 36,72 na quarta a R$ 58,00 no domingo. O
 * padrao existe, mas e um degrade - a sexta (R$ 47,72) fica igual a segunda
 * (R$ 46,81), entao "sexta e social" nao se sustenta. Ja o ESTABELECIMENTO
 * separa quase perfeito: um deles aparece 14 vezes, nunca num fim de semana,
 * sempre perto de R$ 43. Isso e o almoco do trabalho, e o nome ja diz.
 *
 * Dai a inversao que este arquivo implementa: o estabelecimento propoe, o dia
 * da semana e evidencia. E nada vira subcategoria sozinho - a funcao devolve
 * proposta com os numeros ao lado, para a casa aceitar, renomear ou recusar.
 *
 * Uma limitacao que decide o desenho: a fatura de cartao NAO traz hora. Separar
 * "almoco" de "jantar" no mesmo dia e impossivel com este dado, e prometer isso
 * seria inventar.
 */

/** Minimo de lancamentos para um estabelecimento entrar numa proposta. */
const MIN_LANCAMENTOS_ESTABELECIMENTO = 3;
/** Minimo de meses distintos, para nao sugerir a partir de um mes atipico. */
const MIN_MESES = 2;
/** Minimo de lancamentos somados para a proposta existir. */
const MIN_LANCAMENTOS_PROPOSTA = 6;

/** Acima disto, o ticket ja nao e refeicao avulsa - e compra para a casa. */
const TICKET_MERCADO = 8_000;

/** A partir daqui, "so acontece em dia util" deixa de ser coincidencia. */
const DIA_UTIL_FORTE = 0.85;

/** Minimo de cobrancas para o dia do mes valer como sinal de faturamento. */
const MIN_PARA_DIA_DO_MES = 4;
/** Acima disto, cair sempre no mesmo dia do mes e calendario de cobranca. */
const MESMO_DIA_DO_MES = 0.75;

/**
 * Quanto o fim de semana precisa pesar acima do normal da categoria.
 *
 * MEDIDO: nos oito meses reais, 70,9% da alimentacao cai em dia util - quase
 * identico aos 5/7 (71,4%) do calendario. Entao "metade no fim de semana" ja e
 * 1,7x o habitual, e nao um empate como o numero 50% sugere a primeira vista.
 *
 * O corte sai da taxa-base MEDIDA, nao de uma constante: uma casa que almoca
 * fora todo sabado tem outro normal, e comparar com 5/7 fixo acusaria padrao
 * onde so existe a rotina dela.
 */
const FIM_DE_SEMANA_ACIMA_DO_NORMAL = 1.6;

/** Se a categoria toda cair de um lado so, nao ha base com que comparar. */
const BASE_DEGENERADA = 0.05;
/** O normal do calendario, usado quando a base medida nao serve. */
const BASE_DO_CALENDARIO = 5 / 7;

/**
 * Nomes que dizem "isto e compra de mercado", nao refeicao.
 *
 * Existe porque o ticket sozinho erra: um hortifruti de R$ 90 e mercado, mas
 * um jantar de R$ 90 tambem passa do corte. O nome desempata, e foi uma
 * correcao humana que trouxe esta regra - o dado sozinho tinha classificado
 * um hortifruti como refeicao de fim de semana.
 */
/*
 * Radicais abertos com `\w*`, e nao fechados com `\b`. O `\b` no fim de um
 * radical exige fronteira logo apos ele, entao `atacad\b` NAO casa com
 * "ATACADISTA" - o mesmo tropeco ja tinha acontecido com `ortoped` e
 * "ortopedista" na classificacao de eventos.
 *
 * `mercado` e a excecao deliberada: fica fechado, porque `mercad\w*` casaria
 * com "MERCADOLIVRE", que e marketplace e nao mercearia.
 */
const NOME_DE_MERCADO =
  /\b(mercado|feira|supermerc\w*|atacad\w*|hortifruti\w*|hortfruti\w*|sacol[aã]o|quitanda|armaz[eé]m|emp[oó]rio)\b/i;

export type SuggestionKey = "rotina" | "mercado" | "fim_de_semana";

export interface MerchantStat {
  merchant: string;
  label: string;
  count: number;
  totalCents: Cents;
  medianCents: Cents;
  /** 0 a 1. Fracao dos lancamentos em dia util (segunda a sexta). */
  weekdayShare: number;
  monthsSeen: number;
}

export interface SubcategorySuggestion {
  key: SuggestionKey;
  /** Nome proposto. A tela deixa editar antes de criar. */
  suggestedName: string;
  merchants: MerchantStat[];
  count: number;
  totalCents: Cents;
  medianCents: Cents;
  weekdayShare: number;
  monthsSeen: number;
}

const NOME_PROPOSTO: Record<SuggestionKey, string> = {
  rotina: "Rotina de dia útil",
  mercado: "Mercado",
  fim_de_semana: "Fim de semana",
};

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

/** 0 = domingo. `T00:00:00Z` porque em fuso negativo a data anda um dia. */
function isWeekday(date: IsoDate): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

function countable(t: Transaction): boolean {
  return (
    !t.isHidden &&
    t.status !== "cancelled" &&
    t.status !== "forecast" &&
    spendingCents(t) > 0
  );
}

/**
 * Fracao dos lancamentos em dia util no conjunto todo - o "normal" desta casa.
 *
 * Serve de regua: um estabelecimento so conta como de fim de semana se pesar
 * mais no fim de semana do que a categoria inteira ja pesa.
 */
function baseDiaUtil(transactions: readonly Transaction[]): number {
  const uteis = transactions.filter((t) => isWeekday(t.date)).length;
  const base = transactions.length === 0 ? 0 : uteis / transactions.length;
  // Tudo de um lado so nao e base, e ausencia de contraste.
  if (base <= BASE_DEGENERADA || base >= 1 - BASE_DEGENERADA) {
    return BASE_DO_CALENDARIO;
  }
  return base;
}

/**
 * A cobranca e de uma MAQUINA, e nao de uma escolha?
 *
 * Esta funcao existe porque a primeira versao propunha, com toda a confianca,
 * "Assinaturas > Fim de semana" para um servico que cobra todo domingo, e
 * "Assinaturas > Rotina de dia util" para a Netflix. Nenhuma das duas diz nada:
 * o dia de uma assinatura e o do faturamento do fornecedor, nao o da vida de
 * quem paga. Dia da semana so e evidencia onde a pessoa ESCOLHE o dia.
 *
 * MEDIDO nos 584 lancamentos reais, e a separacao e limpa, sem fronteira:
 *
 *   - toda assinatura cobra SEMPRE o mesmo valor - 1 valor distinto em 5, 8,
 *     11 cobrancas (Netflix, Google, Apple, Starlink, anuidade, contabilidade);
 *   - todo estabelecimento de comportamento varia - o mais constante deles,
 *     uma confeitaria com 10 visitas, ja tem 4 valores distintos.
 *
 * O segundo sinal pega o que o primeiro deixa passar: cobranca que muda de
 * valor mas cai sempre no MESMO DIA DO MES (Starlink, ChatGPT por uso). Exige
 * quatro ocorrencias porque com tres o mesmo dia ainda sai por acaso.
 */
function pareceCobrancaFixa(valores: readonly Cents[], datas: readonly IsoDate[]): boolean {
  if (new Set(valores).size === 1) return true;

  if (datas.length < MIN_PARA_DIA_DO_MES) return false;
  const porDiaDoMes = new Map<string, number>();
  for (const data of datas) {
    const dia = data.slice(8, 10);
    porDiaDoMes.set(dia, (porDiaDoMes.get(dia) ?? 0) + 1);
  }
  const maior = Math.max(...porDiaDoMes.values());
  return maior / datas.length > MESMO_DIA_DO_MES;
}

/** Em que balde o estabelecimento cai. `null` = nao da para dizer. */
function classify(stat: MerchantStat, base: number): SuggestionKey | null {
  // O nome vence o ticket: hortifruti de R$ 90 e mercado, jantar de R$ 90 nao.
  if (NOME_DE_MERCADO.test(stat.merchant) || NOME_DE_MERCADO.test(stat.label)) {
    return "mercado";
  }
  // Ticket alto NAO e sinal de mercado. A primeira versao tinha essa regra e
  // ela mandava um restaurante caro de sabado para "mercado" - porque so
  // olhava o valor. Um jantar de R$ 95 e um hortifruti de R$ 95 custam o
  // mesmo e nao sao a mesma coisa; o que os separa e o nome, acima.
  //
  // Para rotina o corte e absoluto (e nao relativo a base): "nunca num fim de
  // semana" convence por ser um teto, nao por ser multiplo do normal - 100%
  // sobre uma base de 71% seria so 1,4x, um numero fraco para um sinal forte.
  if (stat.weekdayShare >= DIA_UTIL_FORTE && stat.medianCents < TICKET_MERCADO) {
    return "rotina";
  }
  const limite = 1 - (1 - base) * FIM_DE_SEMANA_ACIMA_DO_NORMAL;
  if (stat.weekdayShare <= limite) return "fim_de_semana";
  return null;
}

/**
 * Propoe subcategorias para os lancamentos de UMA categoria.
 *
 * Devolve lista vazia sem hesitar quando nao ha evidencia: menos de dois
 * meses, poucos lancamentos, ou nenhum agrupamento que se sustente. Sugerir a
 * partir de um mes atipico ensinaria o app a errar para sempre - a regra
 * aprendida sobrevive a fatura que a criou.
 */
export function suggestSubcategories(
  transactions: readonly Transaction[],
): SubcategorySuggestion[] {
  const porEstabelecimento = new Map<
    string,
    {
      label: string;
      valores: Cents[];
      dias: boolean[];
      datas: IsoDate[];
      meses: Set<string>;
    }
  >();

  for (const t of transactions) {
    if (!countable(t)) continue;
    // Ja tem subcategoria: a casa decidiu, e proposta nao desfaz decisao.
    if (t.subcategoryId !== null) continue;
    const key = t.merchantNormalized;
    if (!key) continue;

    const atual = porEstabelecimento.get(key) ?? {
      label: t.merchantAlias ?? t.description,
      valores: [],
      dias: [],
      datas: [],
      meses: new Set<string>(),
    };
    atual.valores.push(spendingCents(t));
    atual.dias.push(isWeekday(t.date));
    atual.datas.push(t.date);
    atual.meses.add(t.invoiceMonth);
    porEstabelecimento.set(key, atual);
  }

  const stats: MerchantStat[] = [];
  for (const [merchant, dados] of porEstabelecimento) {
    if (dados.valores.length < MIN_LANCAMENTOS_ESTABELECIMENTO) continue;
    // Assinatura fica de fora inteira, e nao so do balde: o dia dela nao e
    // escolha de ninguem, entao ela nao pode nem propor nem entrar no numero
    // de uma proposta que outro estabelecimento levantou.
    if (pareceCobrancaFixa(dados.valores, dados.datas)) continue;
    stats.push({
      merchant,
      label: dados.label,
      count: dados.valores.length,
      totalCents: dados.valores.reduce((a, b) => a + b, 0),
      medianCents: median(dados.valores),
      weekdayShare: dados.dias.filter(Boolean).length / dados.dias.length,
      monthsSeen: dados.meses.size,
    });
  }

  const base = baseDiaUtil(transactions.filter(countable));

  const baldes = new Map<SuggestionKey, MerchantStat[]>();
  for (const stat of stats) {
    const key = classify(stat, base);
    if (!key) continue;
    const lista = baldes.get(key) ?? [];
    lista.push(stat);
    baldes.set(key, lista);
  }

  const out: SubcategorySuggestion[] = [];
  for (const [key, merchants] of baldes) {
    const count = merchants.reduce((s, m) => s + m.count, 0);
    // Extensao do balde: a do estabelecimento mais antigo dele. Somar os meses
    // de cada um contaria o mesmo mes varias vezes.
    const monthsSeen = Math.max(...merchants.map((m) => m.monthsSeen));
    if (count < MIN_LANCAMENTOS_PROPOSTA || monthsSeen < MIN_MESES) continue;

    const totalCents = merchants.reduce((s, m) => s + m.totalCents, 0);
    out.push({
      key,
      suggestedName: NOME_PROPOSTO[key],
      merchants: merchants.sort((a, b) => b.totalCents - a.totalCents),
      count,
      totalCents,
      medianCents: median(merchants.flatMap((m) => Array(m.count).fill(m.medianCents))),
      weekdayShare:
        merchants.reduce((s, m) => s + m.weekdayShare * m.count, 0) / count,
      monthsSeen,
    });
  }

  return out.sort((a, b) => b.totalCents - a.totalCents);
}
