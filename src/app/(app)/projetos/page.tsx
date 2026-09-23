import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveHouse } from "@/lib/houses";
import { listCategories, listProjectItems, listProjects } from "@/data/queries";
import { projectSummary, savingsFromChoices } from "@/domain/project";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { ProjectManager } from "@/components/project/project-manager";
import { NewProject } from "@/components/project/new-project";
import { SheetImport } from "@/components/project/sheet-import";
import { ProjectCategory } from "@/components/project/project-category";

export const metadata: Metadata = { title: "Projetos · Fluxo" };

/**
 * Projetos (secao 15).
 *
 * Responde uma pergunta só, e por isso a tela é uma lista de itens: "o que foi
 * comprado, o que não foi, o que foi comprado pela metade".
 *
 * "Projeto" e não "obra" porque a forma serve a qualquer coisa que se compre
 * por partes depois de juntar propostas — a reforma de agora, e o que vier
 * depois. O gasto entra nos totais da casa como qualquer outro: esta tela é o
 * recorte que conta a história por item, não um caixa separado.
 */
export default async function ProjetosPage({
  searchParams,
}: {
  searchParams: Promise<{ projeto?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const projects = await listProjects(active.id);

  if (projects.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader
            title="Projetos"
            description="Junte as propostas, escolha uma, e acompanhe o que já foi comprado, o que falta e o que veio pela metade."
          />
          <NewProject />
        </Card>
      </div>
    );
  }

  // O pedido da URL vence; sem ele, o mais recente. Um id inválido não quebra
  // a tela — cai no primeiro, que é o que alguém esperaria ao voltar.
  const project =
    projects.find((p) => p.id === params.projeto) ?? projects[0]!;

  const [items, categories] = await Promise.all([
    listProjectItems(active.id, project.id),
    listCategories(active.id),
  ]);
  const categoria = categories.find((c) => c.id === project.categoryId) ?? null;
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
            tirado de proposta única ensinaria a não confiar no resto. */}
        {economia !== 0 ? (
          <p className="mt-0.5 text-[13px] text-ink-faint">
            {economia > 0 ? "Economizou " : "Pagou a mais "}
            <span className={economia > 0 ? "text-positive" : "text-danger"}>
              {formatCents(Math.abs(economia))}
            </span>{" "}
            em relação à média das outras propostas.
          </p>
        ) : null}
        <div className="mt-3">
          <ProjectCategory
            projectId={project.id}
            categoryId={project.categoryId}
            categories={categories}
          />
        </div>
      </header>

      {/* O seletor só existe quando há o que selecionar: com um projeto só,
          uma aba solitária seria enfeite pedindo um clique que não leva a
          lugar nenhum. */}
      {projects.length > 1 ? (
        <nav className="flex flex-wrap gap-1.5" aria-label="Projetos da casa">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projetos?projeto=${p.id}`}
              aria-current={p.id === project.id ? "page" : undefined}
              className={cn(
                "rounded-[--radius-control] px-2.5 py-1.5 text-[12px]",
                p.id === project.id
                  ? "bg-surface-3 text-ink"
                  : "bg-surface-2 text-ink-faint",
              )}
            >
              {p.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <CardHeader
            title="Ainda sem itens"
            description="Se a lista já existe numa planilha, suba o arquivo. Senão, comece pelo que você já sabe que precisa comprar — cotação e compra entram depois, item por item."
          />
          <SheetImport projectId={project.id} />
        </Card>
      ) : null}

      <ProjectManager
        projectId={project.id}
        summary={summary}
        categoryLabel={categoria?.name ?? null}
      />

      {/* Depois da lista, e não antes: com itens na tela, subir planilha é o
          caso raro (um bloco novo da obra), e o comum é registrar a compra do
          que já está ali. */}
      {items.length > 0 ? (
        <Card>
          <CardHeader
            title="Itens de uma planilha"
            description="Abre o arquivo aqui no aparelho e mostra o que encontrou. O que o projeto já tem não entra de novo."
          />
          <SheetImport projectId={project.id} />
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Outro projeto"
          description="Vale para qualquer coisa que se compre por partes depois de juntar propostas."
        />
        <NewProject />
      </Card>
    </div>
  );
}
