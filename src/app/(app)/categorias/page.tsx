import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse } from "@/lib/houses";
import { listCategories } from "@/data/queries";
import { CategoriesManager } from "@/components/categories/categories-manager";

export const metadata: Metadata = { title: "Categorias · Fluxo" };

export default async function CategoriasPage() {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const categories = await listCategories(active.id);

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

      <CategoriesManager categories={categories} />
    </div>
  );
}
