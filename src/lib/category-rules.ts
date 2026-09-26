import "server-only";
import {
  categoryFromHint,
  categoryFromMerchant,
  matchCategoryNames,
  normalizeMerchant,
} from "@/importers/detect";
import type { createClient } from "@/lib/supabase/server";

/**
 * Em que categoria um estabelecimento cai, pelas regras da casa.
 *
 * Saiu de `actions/import.ts` quando a mesma decisao passou a servir tambem
 * ao lancamento manual (a sugestao ao digitar a descricao) e a conversa:
 * tres portas de entrada, uma regra so. Se cada uma decidisse por conta
 * propria, a mesma loja cairia em categorias diferentes dependendo de onde
 * foi lancada.
 */

/**
 * Tudo que a casa sabe sobre categorias, no formato em que a decisão precisa.
 *
 * Carregado uma vez por operação e passado adiante: a resolução roda por
 * lançamento, e ir ao banco a cada linha seria uma consulta por compra.
 */
/**
 * O que uma regra aprendida manda fazer com um estabelecimento.
 *
 * Passou a carregar a subcategoria quando o app comecou a PROPOR subcategorias
 * por comportamento (secao 14): antes disso a coluna `subcategory_id` existia
 * em `learned_rules` e nao era lida por ninguem, entao a subcategoria decidida
 * numa fatura se perdia na seguinte.
 */
export interface RuleTarget {
  categoryId: string | null;
  subcategoryId: string | null;
}

export interface CategoryMaps {
  ruleByPattern: Map<string, RuleTarget>;
  byName: Map<string, string>;
  nameById: Map<string, string>;
  /** id -> id da categoria-mãe, ou `null` para categoria-mãe. */
  parentById: Map<string, string | null>;
  /**
   * Nome canônico ("Transporte") -> id da categoria da casa que o atende.
   *
   * Existe porque a casa pode renomear: quem chama de "Carro" o que veio como
   * "Transporte" perdia toda sugestão daquela categoria, em silêncio.
   */
  byCanonical: Map<string, string>;
}

export async function loadCategoryMaps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  houseId: string,
): Promise<CategoryMaps> {
  const [{ data: rules }, { data: categories }] = await Promise.all([
    supabase
      .from("learned_rules")
      .select("normalized_pattern, category_id, subcategory_id")
      .eq("house_id", houseId),
    supabase
      .from("categories")
      .select("id, name, parent_id")
      .eq("house_id", houseId)
      .eq("is_active", true),
  ]);

  const byName = new Map<string, string>(
    (categories ?? []).map((c) => [
      normalizeMerchant(String(c.name)),
      c.id as string,
    ]),
  );

  const byCanonical = new Map<string, string>();
  for (const [canonical, realName] of matchCategoryNames(
    (categories ?? []).map((c) => String(c.name)),
  )) {
    const id = byName.get(normalizeMerchant(realName));
    if (id) byCanonical.set(canonical, id);
  }

  return {
    ruleByPattern: new Map(
      (rules ?? []).map((r) => [
        String(r.normalized_pattern),
        {
          categoryId: r.category_id as string | null,
          subcategoryId: r.subcategory_id as string | null,
        },
      ]),
    ),
    byName,
    nameById: new Map(
      (categories ?? []).map((c) => [c.id as string, String(c.name)]),
    ),
    parentById: new Map(
      (categories ?? []).map((c) => [c.id as string, c.parent_id as string | null]),
    ),
    byCanonical,
  };
}

/**
 * Em que categoria este lançamento cai, e por quê.
 *
 * Ordem por confiança, da maior para a menor:
 *
 * 1. regra aprendida - a casa já disse, à mão, onde isto vai;
 * 2. nome do estabelecimento - "ELETROGRAAL" é recarga de carro elétrico,
 *    independente do que o banco ache;
 * 3. categoria do arquivo, traduzida - cobre o que a tabela não conhece;
 * 4. tipo do lançamento - só serve para tarifa.
 *
 * O nome da loja vem ANTES da dica do banco de propósito: a do banco sai do
 * ramo cadastrado na maquininha e erra muito. Numa fatura real ela chamava
 * supermercado de "Associação" e restaurante de "Supermercados".
 *
 * Uma função só, usada pela importação e pela reanálise, para as duas não
 * divergirem - foi assim que o total da fatura já saiu errado antes.
 */
export type CategorySource = "regra" | "loja" | "banco" | "tipo";

export function resolveCategory(
  input: {
    merchantNormalized: string;
    categoryHint: string | null;
    type: string;
  },
  maps: CategoryMaps,
): { id: string | null; source: CategorySource | null } {
  /** Nome canônico da tabela -> categoria da casa, mesmo renomeada. */
  const canonical = (name: string | null) =>
    name ? maps.byCanonical.get(name) : undefined;
  /** Nome cru vindo do arquivo, que pode coincidir com o da casa. */
  const literal = (name: string | null) =>
    name ? maps.byName.get(normalizeMerchant(name)) : undefined;

  const fromRule = maps.ruleByPattern.get(input.merchantNormalized)?.categoryId;
  if (fromRule) return { id: fromRule, source: "regra" };
  const fromMerchant = canonical(categoryFromMerchant(input.merchantNormalized));
  if (fromMerchant) return { id: fromMerchant, source: "loja" };
  const fromHint = input.categoryHint
    ? (literal(input.categoryHint) ??
       canonical(categoryFromHint(input.categoryHint)))
    : undefined;
  if (fromHint) return { id: fromHint, source: "banco" };
  const fromType = input.type === "fee" ? canonical("Tarifas") : undefined;
  if (fromType) return { id: fromType, source: "tipo" };
  return { id: null, source: null };
}

export function resolveCategoryId(
  input: {
    merchantNormalized: string;
    categoryHint: string | null;
    type: string;
  },
  maps: CategoryMaps,
): string | null {
  return resolveCategory(input, maps).id;
}

/**
 * Subcategoria que a regra aprendida manda, se houver.
 *
 * So vale quando a regra e a linha concordam sobre a categoria-mae. Sem essa
 * checagem, uma linha que caiu em Mercado pelo nome da loja receberia a
 * subcategoria "Rotina de dia util" de Alimentacao, e a subcategoria ficaria
 * pendurada numa arvore a que nao pertence.
 */
export function resolveSubcategoryId(
  merchantNormalized: string,
  categoryId: string | null,
  maps: CategoryMaps,
): string | null {
  if (categoryId === null) return null;
  const rule = maps.ruleByPattern.get(merchantNormalized);
  if (!rule || rule.categoryId !== categoryId) return null;
  return rule.subcategoryId;
}
