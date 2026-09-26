import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { getTaskBoard } from "@/data/queries";
import { firstName } from "@/domain/chat";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { StartBoard, TaskBoard } from "@/components/tasks/task-board";

export const metadata: Metadata = { title: "Tarefas · Fluxo" };

/**
 * Tarefas da casa (secao 17), em quadro estilo Trello.
 *
 * Colunas que a casa cria, tarefas que andam entre elas. Uma tarefa pode ter
 * valor previsto e lancamentos ligados - o quadro mostra previsto x gasto,
 * e o gasto e a soma dos lancamentos do extrato, nunca um numero digitado.
 */
export default async function TarefasPage() {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const [columns, members] = await Promise.all([getTaskBoard(active.id), listMembers(active.id)]);
  const pessoas = members.map((m) => ({ id: m.userId, name: firstName(m.fullName) }));
  const todayIso = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

  if (columns.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader
            title="Tarefas"
            description="O que a casa tem para fazer, em colunas. Uma tarefa pode ter valor previsto e os lançamentos que ela gerou."
          />
          <EmptyState
            title="Nenhum quadro ainda"
            description="Comece com “A fazer”, “Fazendo” e “Feito” — dá para renomear, reordenar e criar outras depois."
            action={<StartBoard />}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">Tarefas</h1>
        <p className="mt-0.5 text-[13px] text-ink-faint">
          Toque numa tarefa para editar, mudar de coluna ou ligar gastos.
          <span className="hidden md:inline"> No computador, dá para arrastar.</span>
        </p>
      </header>
      <TaskBoard columns={columns} members={pessoas} todayIso={todayIso} />
    </div>
  );
}
