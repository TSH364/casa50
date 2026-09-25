import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse } from "@/lib/houses";
import { countWithoutSubcategory, listCategories } from "@/data/queries";
import { getAiStatus } from "@/lib/ai-config";
import { JevSubcategories } from "@/components/categories/jev-subcategories";
import { CategoriesManager } from "@/components/categories/categories-manager";
import { SubcategorySuggestions } from "@/components/categories/subcategory-suggestions";

export const metadata: Metadata = { title: "Categorias · Fluxo" };

/** O Jev pode levar ate 40 s numa categoria grande (ver `actions/jev.ts`). */
export const maxDuration = 60;

export default async function CategoriasPage() {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const [categories, ai] = await Promise.all([
    listCategories(active.id),
    getAiStatus(active.id),
  ]);

  // O Jev so aparece com chave, e so para categorias que tem subcategorias -
  // sem elas nao ha entre o que escolher.
  const comSubs = categories.filter(
    (c) => c.parentId === null && categories.some((s) => s.parentId === c.id),
  );
  const pendentes =
    ai.source !== null && comSubs.length > 0
      ? await countWithoutSubcategory(active.id, comSubs.map((c) => c.id))
      : new Map<string, number>();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Categorias
        </h1>
        <p className="mt-1 text-[13px] text-ink-faint">
          As iniciais são só um ponto de partida. Renomeie, recolora ou apague o
          que não servir — excluir uma categoria não apaga lançamento nenhum.
        </p>
      </header>

      {/* Antes da lista: e uma proposta esperando resposta, e enterra-la no fim
          da pagina seria o mesmo que nao propor. */}
      <SubcategorySuggestions houseId={active.id} categories={categories} />

      {ai.source !== null ? (
        <JevSubcategories
          rows={comSubs.map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            pending: pendentes.get(c.id) ?? 0,
          }))}
        />
      ) : null}

      <CategoriesManager categories={categories} />
    </div>
  );
}
