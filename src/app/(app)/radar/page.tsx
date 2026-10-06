import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse } from "@/lib/houses";
import { getAiStatus } from "@/lib/ai-config";
import { carregarRadar } from "@/data/radar";
import { RadarManager } from "@/components/radar/radar-manager";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Radar · Fluxo" };

/** A primeira conferencia roda ao cadastrar, e a busca pode levar ~25 s. */
export const maxDuration = 60;

export default async function RadarPage() {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const [radar, ai] = await Promise.all([carregarRadar(active.id), getAiStatus(active.id)]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Radar de produtos</h1>
        <p className="mt-1 text-corpo text-ink-faint">
          O app confere o preço do que vocês querem comprar uma vez por dia e avisa no Início quando chegar na meta ou
          cair. Os preços vêm de uma busca na web: confiram na loja antes de comprar.
        </p>
      </header>

      {radar.disponivel ? (
        <RadarManager itens={radar.itens} temChave={ai.source !== null} agora={Date.now()} />
      ) : (
        <Card>
          <p className="text-corpo text-ink-muted">
            O Radar está sendo instalado no banco. Volte em alguns minutos.
          </p>
        </Card>
      )}
    </div>
  );
}
