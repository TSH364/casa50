import type { Category, CategoryKind, TransactionType } from "./types";

/**
 * Categoria de gasto x categoria de receita.
 *
 * Receita usa as categorias de receita (Salario, Pro-labore, Bolsa...); todo o
 * resto - despesa, estorno, tarifa, pagamento, ajuste - usa as de gasto. Um
 * estorno e dinheiro de uma compra voltando: a categoria dele e a da compra.
 */
export function ladoDoTipo(type: TransactionType | string): CategoryKind {
  return type === "income" ? "income" : "expense";
}

/**
 * As categorias que um lancamento deste lado pode usar.
 *
 * `manter` sao as que o lancamento JA tem: um lancamento antigo marcado do
 * outro lado (uma receita que entrou em "Outros" antes de existir categoria de
 * receita) continua mostrando o que tem em vez de aparecer vazio - e quem
 * olha decide se troca.
 */
export function categoriasDoLado(
  categories: readonly Category[],
  lado: CategoryKind,
  manter: readonly (string | null | undefined)[] = [],
): Category[] {
  const fica = new Set(manter.filter((id): id is string => Boolean(id)));
  // A mae de uma subcategoria mantida tambem fica, ou o seletor perde o grupo.
  for (const c of categories) if (fica.has(c.id) && c.parentId) fica.add(c.parentId);
  return categories.filter((c) => c.kind === lado || fica.has(c.id));
}
