import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { listGoals } from "@/data/queries";
import { GoalsManager } from "@/components/goals/goals-manager";

export const metadata: Metadata = { title: "Metas · Fluxo" };

export default async function MetasPage() {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const [{ goals, deposits }, members] = await Promise.all([
    listGoals(active.id),
    listMembers(active.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Metas</h1>
        <p className="mt-1 text-[13px] text-ink-faint">
          O acumulado é sempre a soma dos aportes registrados — nunca um número
          digitado à mão.
        </p>
      </header>

      <GoalsManager goals={goals} deposits={deposits} members={members} />
    </div>
  );
}
