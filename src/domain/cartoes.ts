/**
 * Nome do cartao.
 *
 * A importacao cria o cartao que o arquivo traz e ainda nao existe, com o
 * nome provisorio "Cartão 2150" (ver `ensureCardsForLastFours`). Pelo final
 * ninguem reconhece qual e qual - foi o pedido da casa: dar nome. Estas
 * funcoes dizem onde o app deve pedir o nome e como mostrar o cartao.
 */

/** O nome ainda e o automatico: "Cartão", "Cartão 2150", "Cartão ···· 2150". */
export function temNomeAutomatico(card: { name: string; lastFour: string | null }): boolean {
  const nome = card.name.trim().replace(/\s+/g, " ");
  if (/^cart[aã]o$/i.test(nome)) return true;
  const m = /^cart[aã]o\s+(?:[·•.*]+\s*)?(\d{4})$/i.exec(nome);
  return m !== null && (card.lastFour === null || m[1] === card.lastFour);
}

/**
 * Como o cartao aparece em filtros e listas: o nome que a casa deu, com o
 * final para desempatar. Com nome automatico, so o final - "Cartão 2150
 * ···· 2150" repetia o numero.
 */
export function rotuloDoCartao(card: { name: string; lastFour: string | null }): string {
  if (temNomeAutomatico(card)) return card.lastFour ? `Cartão ···· ${card.lastFour}` : card.name;
  return card.lastFour ? `${card.name} ···· ${card.lastFour}` : card.name;
}

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * O cartao de um arquivo que nao traz o final - o CSV do Nubank so tem data,
 * descricao e valor. O banco vem do nome do arquivo ("Nubank_2026-11-04.csv"),
 * e o cartao e o unico ativo da casa daquele banco: pela instituicao
 * cadastrada, ou pelo nome ("Nubank Vini").
 *
 * Dois cartoes do mesmo banco: nenhum. Chutar um deles poria a fatura de uma
 * pessoa no cartao da outra; a tela pede para escolher.
 */
export function cartaoDoBanco<T extends { name: string; institution: string | null; isActive: boolean }>(
  cards: readonly T[],
  banco: string | null,
): T | null {
  if (!banco) return null;
  const alvo = semAcento(banco);
  if (!alvo) return null;
  const doBanco = cards.filter((c) => {
    if (!c.isActive) return false;
    if (c.institution && semAcento(c.institution) === alvo) return true;
    return ` ${semAcento(c.name)} `.includes(` ${alvo} `);
  });
  return doBanco.length === 1 ? doBanco[0]! : null;
}
