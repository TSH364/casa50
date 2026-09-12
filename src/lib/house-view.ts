import "server-only";
import { listCategories } from "@/data/queries";
import type { Category } from "@/domain/types";

/**
 * O recorte que as telas de conta usam: o que entra nos totais da casa.
 *
 * Existe porque uma categoria pode ser marcada como "nao conta nos totais" -
 * tipicamente despesa de trabalho que passa pelo cartao pessoal. Sem isso,
 * metade do dinheiro de uma casa pode ser de empresa, e nenhuma media,
 * previsao ou sugestao de orcamento descreve a vida de quem mora ali.
 *
 * A escolha vem de dois lugares, nesta ordem: a marca na categoria decide o
 * padrao, e o parametro da URL permite ver incluido sem desfazer a marca. E
 * lente, nao configuracao: some quando a pessoa sai da tela.
 */
export interface HouseView {
  /** Passar direto para `listTransactions`. Vazio quando se ve tudo. */
  excludeCategoryIds: string[];
  /** As categorias marcadas, para a tela poder dize-las pelo nome. */
  excluded: Category[];
  /** Verdadeiro quando a tela esta mostrando tudo, inclusive o que fica fora. */
  showingAll: boolean;
  /** Todas as categorias da casa - quem chama quase sempre precisa delas. */
  categories: Category[];
}

/** Valor do parametro de URL que pede para incluir tudo. */
export const SHOW_ALL = "tudo";

export async function houseView(
  houseId: string,
  totaisParam?: string,
): Promise<HouseView> {
  const categories = await listCategories(houseId);
  const excluded = categories.filter((c) => c.excludedFromTotals);
  const showingAll = totaisParam === SHOW_ALL;

  return {
    categories,
    excluded,
    showingAll,
    excludeCategoryIds: showingAll ? [] : excluded.map((c) => c.id),
  };
}
