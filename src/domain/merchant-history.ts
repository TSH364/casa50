/**
 * O que a casa ja fez com cada loja, e quando um palpite do Jev vira regra.
 *
 * Duas memorias novas na classificacao, e as protecoes que impedem que um
 * erro se reforce sozinho:
 *
 *   * HISTORICO: loja que ja apareceu pelo menos duas vezes, SEMPRE na mesma
 *     categoria, e decidida sem IA. So conta o que passou pela casa (a mao,
 *     regra, loja conhecida ou o proprio historico) - palpite do Jev e dica
 *     do banco nao contam, ou um palpite errado viraria "historico" no mes
 *     seguinte e se repetiria para sempre. Loja que variou (Mercado Livre:
 *     as vezes TSH, as vezes Casa) nao e decidida: o historico vai para o
 *     Jev como pista, e ele decide compra a compra.
 *   * REGRA DO JEV: importar sem mexer confirma o palpite, e o palpite com
 *     certeza alta (85%+) vira regra - marcada como do Jev (`confidence` < 1),
 *     para qualquer correcao da casa passar por cima na hora.
 */

/** De onde veio a categoria de um lancamento (coluna `category_source`). */
export type CategorySourceDb = "casa" | "regra" | "loja" | "historico" | "banco" | "tipo" | "jev";

/** Fontes que valem como decisao da casa. `null` e lancamento anterior a marcacao. */
const CONFIAVEL: ReadonlySet<CategorySourceDb | null> = new Set([null, "casa", "regra", "loja", "historico"]);

/** Vezes que a loja precisa ter aparecido para o historico decidir sozinho. */
export const HISTORICO_MIN_VEZES = 2;

/** A partir daqui o palpite do Jev, confirmado na importacao, vira regra. */
export const JEV_MIN_REGRA = 0.85;

/**
 * A certeza guardada numa regra do Jev. Nunca 1: 1 e a marca de regra da
 * casa, e e isso que deixa a correcao da casa sempre passar por cima.
 */
export function confiancaDaRegraDoJev(probabilidade: number): number {
  return Math.min(0.999, Math.max(0, Math.round(probabilidade * 1000) / 1000));
}

export interface ContagemCategoria {
  categoryId: string;
  count: number;
}

export interface MerchantHistory {
  /** Loja -> categoria, quando a casa sempre a pos no mesmo lugar (2 vezes ou mais). */
  consistente: Map<string, string>;
  /** Loja -> categorias em que a casa ja a pos, da mais frequente para a menos. */
  porLoja: Map<string, ContagemCategoria[]>;
}

export function montarHistorico(
  linhas: readonly { merchant: string | null; categoryId: string | null; source: CategorySourceDb | null }[],
): MerchantHistory {
  const contagem = new Map<string, Map<string, number>>();
  for (const l of linhas) {
    if (!l.merchant || !l.categoryId || !CONFIAVEL.has(l.source)) continue;
    const porCategoria = contagem.get(l.merchant) ?? new Map<string, number>();
    porCategoria.set(l.categoryId, (porCategoria.get(l.categoryId) ?? 0) + 1);
    contagem.set(l.merchant, porCategoria);
  }

  const consistente = new Map<string, string>();
  const porLoja = new Map<string, ContagemCategoria[]>();
  for (const [loja, porCategoria] of contagem) {
    const lista = [...porCategoria]
      .map(([categoryId, count]) => ({ categoryId, count }))
      .sort((a, b) => b.count - a.count);
    porLoja.set(loja, lista);
    if (lista.length === 1 && lista[0]!.count >= HISTORICO_MIN_VEZES) {
      consistente.set(loja, lista[0]!.categoryId);
    }
  }
  return { consistente, porLoja };
}

/**
 * O historico de uma loja como pista para o Jev: "Na casa, esta loja ja foi
 * classificada como TSH (3 vezes) e Casa (2 vezes)." So nomes de categoria e
 * contagens - nenhum lancamento sai da casa.
 */
export function historicoParaJev(
  entradas: readonly ContagemCategoria[] | undefined,
  nomeDe: ReadonlyMap<string, string>,
): string | null {
  const partes = (entradas ?? [])
    .filter((e) => nomeDe.has(e.categoryId))
    .slice(0, 4)
    .map((e) => `${nomeDe.get(e.categoryId)} (${e.count === 1 ? "1 vez" : `${e.count} vezes`})`);
  if (partes.length === 0) return null;
  const lista = partes.length === 1 ? partes[0]! : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
  return `Na casa, esta loja já foi classificada como ${lista}.`;
}

/**
 * As regras que a importacao confirmada deixa: uma por loja, so quando TODAS
 * as linhas novas dela vieram do Jev, na mesma categoria, com certeza alta.
 * Loja em que o Jev hesitou (uma linha abaixo do corte, ou categorias
 * diferentes) continua palpite no mes seguinte.
 */
export function regrasDoJev(
  linhas: readonly {
    merchantNormalized: string;
    categoryId: string | null;
    categorySource?: CategorySourceDb | null;
    jevProbability?: number | null;
    decision?: string;
  }[],
): { pattern: string; categoryId: string; confidence: number }[] {
  const porLoja = new Map<string, typeof linhas[number][]>();
  for (const l of linhas) {
    if (l.decision !== undefined && l.decision !== "new") continue;
    if (!l.merchantNormalized) continue;
    const g = porLoja.get(l.merchantNormalized) ?? [];
    g.push(l);
    porLoja.set(l.merchantNormalized, g);
  }

  const regras: { pattern: string; categoryId: string; confidence: number }[] = [];
  for (const [loja, g] of porLoja) {
    const todasDoJev = g.every(
      (l) => l.categorySource === "jev" && l.categoryId !== null && (l.jevProbability ?? 0) >= JEV_MIN_REGRA,
    );
    if (!todasDoJev) continue;
    const categorias = new Set(g.map((l) => l.categoryId));
    if (categorias.size !== 1) continue;
    const menor = Math.min(...g.map((l) => l.jevProbability ?? 0));
    regras.push({ pattern: loja, categoryId: g[0]!.categoryId!, confidence: confiancaDaRegraDoJev(menor) });
  }
  return regras;
}
