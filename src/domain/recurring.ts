import type { Cents } from "@/lib/money";
import type { IsoDate, Transaction } from "./types";
import { merchantKey } from "./merchants";

/**
 * Reconhecer a cobranca que uma MAQUINA emite, e nao uma pessoa escolhe.
 *
 * Dois lugares do app precisam da mesma pergunta, e por motivos diferentes:
 *
 *   - a proposta de subcategoria (secao 14) usa dia da semana como evidencia,
 *     e dia da semana so significa algo onde a pessoa escolheu o dia;
 *   - o vinculo de gasto com compromisso (secao 11) mostra o que aconteceu nos
 *     dias do evento, e uma assinatura que cai no meio da viagem nao e despesa
 *     da viagem - so coincidiu.
 *
 * Estava escrito so no primeiro. Trazer para ca evita as duas copias
 * divergirem, que e como o total da fatura ja saiu errado antes neste projeto.
 *
 * POR QUE E HEURISTICA, e nao consulta: o schema tem `recurring_id` para ligar
 * um lancamento a uma recorrencia cadastrada, e MEDIDO na base real ele esta
 * preenchido em ZERO dos 596 lancamentos - a importacao de fatura nunca liga
 * as duas coisas, mesmo havendo cinco recorrencias cadastradas na casa.
 * Perguntar ao banco devolveria "nao ha nenhuma" e a tela continuaria errada.
 */

/** Minimo de cobrancas para um estabelecimento poder ser julgado. */
const MIN_COBRANCAS = 3;
/** Minimo para o dia do mes valer como sinal de calendario de faturamento. */
const MIN_PARA_DIA_DO_MES = 4;
/** Acima disto, cair sempre no mesmo dia do mes e faturamento, nao escolha. */
const MESMO_DIA_DO_MES = 0.75;

export type FixedChargeReason = "same_amount" | "same_day";

/**
 * Estabelecimentos cujas cobrancas parecem emitidas por um sistema.
 *
 * MEDIDO nos 584 lancamentos reais, e a separacao e limpa, sem fronteira:
 *
 *   - toda assinatura cobra SEMPRE o mesmo valor - 1 valor distinto em 5, 8 ou
 *     11 cobrancas (streaming, Google, Apple, anuidade, contabilidade);
 *   - todo estabelecimento de comportamento varia - o restaurante mais
 *     frequentado tem 11 valores em 14 visitas, e o mais constante de todos,
 *     uma confeitaria, ainda tem 4 em 10.
 *
 * O segundo sinal pega o que o primeiro deixa passar: cobranca que muda de
 * valor mas cai sempre no MESMO DIA DO MES (internet, servico por uso). Exige
 * quatro ocorrencias porque com tres o mesmo dia ainda sai por acaso.
 */
export function fixedChargeMerchants(
  transactions: readonly Transaction[],
): Map<string, FixedChargeReason> {
  const porEstabelecimento = new Map<
    string,
    { valores: Cents[]; datas: IsoDate[] }
  >();

  for (const t of transactions) {
    const key = merchantKey(t);
    if (!key) continue;
    const atual = porEstabelecimento.get(key) ?? { valores: [], datas: [] };
    // O valor bruto, e nao o com sinal contabil: o que interessa aqui e se a
    // cobranca repete identica, e estorno nao muda isso.
    atual.valores.push(Math.round(t.amount * 100));
    atual.datas.push(t.date);
    porEstabelecimento.set(key, atual);
  }

  const out = new Map<string, FixedChargeReason>();
  for (const [merchant, { valores, datas }] of porEstabelecimento) {
    if (valores.length < MIN_COBRANCAS) continue;

    if (new Set(valores).size === 1) {
      out.set(merchant, "same_amount");
      continue;
    }

    if (datas.length < MIN_PARA_DIA_DO_MES) continue;
    const porDiaDoMes = new Map<string, number>();
    for (const data of datas) {
      const dia = data.slice(8, 10);
      porDiaDoMes.set(dia, (porDiaDoMes.get(dia) ?? 0) + 1);
    }
    if (Math.max(...porDiaDoMes.values()) / datas.length > MESMO_DIA_DO_MES) {
      out.set(merchant, "same_day");
    }
  }

  return out;
}

/** Por que o app acha que um lancamento NAO e gasto de compromisso. */
export type NotEventReason = "installment" | FixedChargeReason;

/**
 * O app sabe que este lancamento nao pertence ao compromisso do dia?
 *
 * A PARCELA e o caso mais grave, e o que motivou isto. Ela guarda a data da
 * COMPRA original, entao todas as parcelas de uma compra caem no mesmo dia do
 * calendario - e um compromisso naquele dia soma a compra inteira varias
 * vezes. MEDIDO na base real: um compromisso em 10/11/2025 veria a mesma
 * compra duas vezes e somaria R$ 4.884 onde ha uma cobranca de R$ 2.442; um
 * em 07/01/2026 veria sete parcelas e somaria R$ 3.990 por uma compra de
 * R$ 570. Nao e ruido no palpite: e multiplicar o gasto do dia.
 *
 * Devolve o MOTIVO, e nao apenas `true`, porque a tela precisa dizer por que
 * deixou de fora - "isto e parcela" e verificavel, "o app achou melhor" nao.
 * E nada disto decide: a pessoa continua podendo vincular a mao.
 */
export function notEventSpend(
  t: Transaction,
  fixed: ReadonlyMap<string, FixedChargeReason>,
): NotEventReason | null {
  if (t.installment !== null) return "installment";
  if (t.recurringId !== null) return "same_amount";
  const key = merchantKey(t);
  return (key && fixed.get(key)) || null;
}
