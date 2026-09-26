import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { listCards, suggestCardOwners } from "@/data/queries";
import { CardsManager } from "@/components/cards/cards-manager";
import { getAiStatus } from "@/lib/ai-config";

export const metadata: Metadata = { title: "Cartões · Fluxo" };

/** A pergunta ao Jev sobre o dono le todos os lancamentos da casa. */
export const maxDuration = 60;

export default async function CartoesPage() {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const [cards, members, sugestoes, ai] = await Promise.all([
    listCards(active.id),
    listMembers(active.id),
    suggestCardOwners(active.id),
    getAiStatus(active.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Cartões</h1>
      <CardsManager
        cards={cards}
        members={members}
        ownerSuggestions={Object.fromEntries(sugestoes)}
        aiEnabled={ai.source !== null}
      />
    </div>
  );
}
