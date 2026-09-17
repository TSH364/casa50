import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse } from "@/lib/houses";
import { getActiveProject, listProjectItems } from "@/data/queries";
import { projectSummary, savingsFromChoices } from "@/domain/project";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { ProjectManager } from "@/components/project/project-manager";
import { NewProject } from "@/components/project/new-project";

export const metadata: Metadata = { title: "Obra · Fluxo" };

/**
 * A obra (secao 15).
 *
 * Responde uma pergunta só, e por isso a tela é uma lista de itens: "o que foi
 * comprado, o que não foi, o que foi comprado pela metade". O gasto da obra
 * entra nos totais da casa como qualquer outro — esta tela é o recorte que
 * conta a história por item, não um caixa separado.
 */
export default async function ObraPage() {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const project = await getActiveProject(active.id);

  if (!project) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader
            title="Obra"
            description="Acompanhe o que já foi comprado, o que falta e o que veio pela metade."
          />
          <NewProject />
        </Card>
      </div>
    );
  }

  const items = await listProjectItems(active.id, project.id);
  const summary = projectSummary(items);
  const economia = savingsFromChoices(items);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">
          {project.name}
        </h1>
        {/* A economia só aparece quando houve concorrência de verdade: sem
            duas propostas não há o que comparar, e um número de economia
            inventado a partir de proposta única ensinaria a não confiar. */}
        {economia !== 0 ? (
          <p className="mt-0.5 text-[13px] text-ink-faint">
            {economia > 0 ? "Economizou " : "Pagou a mais "}
            <span className={economia > 0 ? "text-positive" : "text-danger"}>
              {formatCents(Math.abs(economia))}
            </span>{" "}
            em relação à média das outras propostas.
          </p>
        ) : null}
      </header>

      {items.length === 0 ? (
        <Card>
          <CardHeader
            title="Ainda sem itens"
            description="Comece pelo que você já sabe que precisa comprar. Cotação e compra entram depois, item por item."
          />
        </Card>
      ) : null}

      <ProjectManager projectId={project.id} summary={summary} />
    </div>
  );
}
