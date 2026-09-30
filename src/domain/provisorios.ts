import { normalizeMerchant } from "@/importers/detect";
import type { Cents } from "@/lib/money";

/**
 * Lancamento provisorio: o que entrou durante o mes, antes da fatura - a mao,
 * pela conversa, e (depois) pelo Open Finance - e que a fatura vai trazer de
 * novo quando fechar.
 *
 * Sem conciliacao, a compra da padaria lancada no dia 15 contaria duas vezes
 * no fim do mes: uma pelo lancamento a mao, outra pela linha da fatura. A
 * deteccao de repeticao da importacao nao pega, porque exige a chave exata, e
 * "padaria" nunca e igual a "PADARIA DO ZE LTDA".
 *
 * A regra: a linha da fatura FICA (e o dado do banco, e a importacao sabe
 * desfazer); o provisorio sai das contas (status `cancelled`, marcado como
 * conciliado) e passa para ela o que a casa decidiu - categoria, nota,
 * apelido, de quem e. Desfazer a importacao devolve o provisorio.
 */

/** Dias de folga entre a data lancada e a da fatura (compra de sexta aparece na segunda). */
export const DIAS_DE_FOLGA = 3;
/** Diferenca de valor aceita: "gastei 40" para uma compra de R$ 39,90. */
const FOLGA_PROPORCIONAL = 0.02;
const FOLGA_MAXIMA_CENTS = 500;

export interface Provisorio {
  id: string;
  date: string;
  amountCents: Cents;
  type: string;
  cardId: string | null;
  /** O que a casa escreveu: descricao ou apelido. */
  texto: string;
  installmentCurrent: number | null;
  installmentTotal: number | null;
}

export interface LinhaDaFatura {
  chave: string;
  date: string;
  amountCents: Cents;
  type: string;
  cardId: string | null;
  merchantNormalized: string;
  installmentCurrent: number | null;
  installmentTotal: number | null;
}

/**
 * E provisorio: entrou fora de uma fatura, esta valendo e ainda nao foi
 * conciliado. So o que vai no cartao espera a fatura - Pix e dinheiro ja
 * sao o registro final.
 */
export function ehProvisorio(t: {
  invoiceId: string | null;
  cardId: string | null;
  origin: string;
  status: string;
  isReconciled: boolean;
}): boolean {
  return (
    t.invoiceId === null &&
    t.cardId !== null &&
    (t.origin === "manual" || t.origin === "imported_statement") &&
    t.status === "confirmed" &&
    !t.isReconciled
  );
}

function diasEntre(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a.slice(0, 10)}T12:00:00Z`) - Date.parse(`${b.slice(0, 10)}T12:00:00Z`));
  return Math.round(ms / 86_400_000);
}

function palavras(texto: string): Set<string> {
  return new Set(
    normalizeMerchant(texto)
      .split(" ")
      .filter((p) => p.length >= 3),
  );
}

/** 0 a 1: quanto do que a casa escreveu aparece no nome que o banco mandou. */
function parecenca(textoDaCasa: string, merchant: string): number {
  const casa = palavras(textoDaCasa);
  if (casa.size === 0) return 0;
  const banco = palavras(merchant);
  let comuns = 0;
  for (const p of casa) {
    if ([...banco].some((b) => b.startsWith(p) || p.startsWith(b))) comuns += 1;
  }
  return comuns / casa.size;
}

/** Pontua o par, ou `null` quando nao pode ser a mesma compra. */
export function pontuar(linha: LinhaDaFatura, p: Provisorio): number | null {
  if (linha.type !== p.type) return null;
  // Parcela so casa com a mesma parcela; compra a vista, com compra a vista.
  if ((linha.installmentTotal ?? null) !== (p.installmentTotal ?? null)) return null;
  if ((linha.installmentCurrent ?? null) !== (p.installmentCurrent ?? null)) return null;
  // Cartao diferente e outra compra. Provisorio sem cartao pode ser qualquer um.
  if (p.cardId !== null && linha.cardId !== null && p.cardId !== linha.cardId) return null;

  const dias = diasEntre(linha.date, p.date);
  if (dias > DIAS_DE_FOLGA) return null;

  const diferenca = Math.abs(linha.amountCents - p.amountCents);
  const folga = Math.min(FOLGA_MAXIMA_CENTS, Math.round(linha.amountCents * FOLGA_PROPORCIONAL));
  if (diferenca > folga) return null;

  const nome = parecenca(p.texto, linha.merchantNormalized);
  // Valor aproximado so vale com algum sinal a mais: o nome parecido.
  if (diferenca > 0 && nome === 0) return null;

  return (
    100 -
    dias * 10 -
    (diferenca > 0 ? 15 : 0) +
    (p.cardId !== null && p.cardId === linha.cardId ? 10 : 0) +
    Math.round(nome * 20)
  );
}

/**
 * Casa cada provisorio com no maximo uma linha da fatura, e vice-versa.
 *
 * Guloso pela pontuacao: o par mais claro fica primeiro. Duas compras de R$ 12
 * no mesmo dia vao cada uma para uma linha, a mais parecida de cada lado.
 */
export function casarProvisorios<P extends Provisorio>(
  linhas: readonly LinhaDaFatura[],
  provisorios: readonly P[],
): Map<string, P> {
  const pares: { chave: string; p: P; nota: number }[] = [];
  for (const linha of linhas) {
    for (const p of provisorios) {
      const nota = pontuar(linha, p);
      if (nota !== null) pares.push({ chave: linha.chave, p, nota });
    }
  }
  pares.sort((a, b) => b.nota - a.nota || a.p.id.localeCompare(b.p.id));

  const resultado = new Map<string, P>();
  const usados = new Set<string>();
  for (const par of pares) {
    if (resultado.has(par.chave) || usados.has(par.p.id)) continue;
    resultado.set(par.chave, par.p);
    usados.add(par.p.id);
  }
  return resultado;
}

/** A janela de datas em que vale procurar provisorios para estas linhas. */
export function janelaDasLinhas(datas: readonly string[]): { de: string; ate: string } | null {
  if (datas.length === 0) return null;
  const ordenadas = [...datas].map((d) => d.slice(0, 10)).sort();
  const desloca = (d: string, dias: number) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + dias);
    return t.toISOString().slice(0, 10);
  };
  return { de: desloca(ordenadas[0]!, -DIAS_DE_FOLGA), ate: desloca(ordenadas.at(-1)!, DIAS_DE_FOLGA) };
}
