import "server-only";
import { matchCategoryNames } from "@/importers/detect";
import type { CategoryOption } from "@/domain/jev";
import type { createClient } from "@/lib/supabase/server";

/**
 * As categorias da casa, no formato das perguntas ao Jev (secao 15).
 *
 * Cada opcao leva os estabelecimentos que a casa JA pos nela, contados nos
 * lancamentos. E isso que ensina ao Jev o que "TSH" ou "Trabalho" querem dizer
 * NESTA casa - sem mandar lancamento nenhum, so nomes de loja.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface JevHouseContext {
  parents: CategoryOption[];
  /** id da categoria-mae -> subcategorias dela. So entra quem tem alguma. */
  subsByParent: Map<string, CategoryOption[]>;
  nameById: Map<string, string>;
  parentById: Map<string, string | null>;
}

/**
 * Paginado de proposito: o PostgREST corta cada resposta em 1.000 linhas, e
 * a casa real ja passa disso. Sem paginar, os exemplos sairiam so dos
 * lancamentos mais antigos, em silencio.
 */
const PAGINA = 1000;
const MAX_PAGINAS = 10;

export async function loadJevContext(
  supabase: Supabase,
  houseId: string,
): Promise<JevHouseContext> {
  const { data: categorias } = await supabase
    .from("categories")
    .select("id, name, parent_id")
    .eq("house_id", houseId)
    .eq("is_active", true);

  const contagem = new Map<string, Map<string, number>>();
  const contar = (categoriaId: string | null, loja: string | null) => {
    if (!categoriaId || !loja) return;
    const porLoja = contagem.get(categoriaId) ?? new Map<string, number>();
    porLoja.set(loja, (porLoja.get(loja) ?? 0) + 1);
    contagem.set(categoriaId, porLoja);
  };

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const { data, error } = await supabase
      .from("transactions")
      .select("category_id, subcategory_id, merchant_normalized")
      .eq("house_id", houseId)
      .eq("type", "expense")
      .order("id")
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error || !data) break;
    for (const t of data) {
      const loja = t.merchant_normalized as string | null;
      const sub = t.subcategory_id as string | null;
      // O exemplo vai para a subcategoria quando ha uma; senao para a mae.
      // Assim "PADARIA NOVA GLORIA" ensina "Fim de semana", e nao borra
      // Alimentacao com um exemplo que ja tem lugar mais preciso.
      contar(sub ?? (t.category_id as string | null), loja);
    }
    if (data.length < PAGINA) break;
  }

  const exemplosDe = (id: string) =>
    [...(contagem.get(id) ?? new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .map(([loja]) => loja);

  const lista = (categorias ?? []).map((c) => ({
    id: c.id as string,
    name: String(c.name),
    parentId: c.parent_id as string | null,
  }));

  const canonicoPorNome = new Map<string, string>();
  for (const [canonico, nome] of matchCategoryNames(lista.map((c) => c.name))) {
    canonicoPorNome.set(nome, canonico);
  }

  const opcao = (c: (typeof lista)[number]): CategoryOption => ({
    id: c.id,
    name: c.name,
    canonical: c.parentId === null ? (canonicoPorNome.get(c.name) ?? null) : null,
    examples: exemplosDe(c.id),
  });

  const parents = lista.filter((c) => c.parentId === null).map(opcao);
  const subsByParent = new Map<string, CategoryOption[]>();
  for (const c of lista) {
    if (c.parentId === null) continue;
    const subs = subsByParent.get(c.parentId) ?? [];
    subs.push(opcao(c));
    subsByParent.set(c.parentId, subs);
  }

  return {
    parents,
    subsByParent,
    nameById: new Map(lista.map((c) => [c.id, c.name])),
    parentById: new Map(lista.map((c) => [c.id, c.parentId])),
  };
}
