import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { listCards } from "@/data/queries";
import { currentMonth } from "@/domain/month";
import { ImportWizard } from "@/components/import/import-wizard";

export const metadata: Metadata = { title: "Importar fatura · Fluxo" };

export default async function ImportarPage() {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const [cards, members] = await Promise.all([
    listCards(active.id),
    listMembers(active.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Importar fatura
        </h1>
        <p className="mt-1 text-[13px] text-ink-faint">
          O arquivo é lido aqui no seu navegador. Nada é gravado antes de você
          revisar e confirmar.
        </p>
      </header>

      <ImportWizard
        cards={cards}
        members={members}
        currentMonth={currentMonth()}
      />
    </div>
  );
}
