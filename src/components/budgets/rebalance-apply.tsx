"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { applyBudgetChanges } from "@/actions/budgets";
import { Button } from "@/components/ui/button";
import type { MonthKey } from "@/domain/types";

/**
 * Aplica a realocação inteira, num clique.
 *
 * Sem edição campo a campo aqui de propósito: quem quiser mexer num limite
 * específico faz isso na lista logo abaixo, que é onde os limites moram. Este
 * botão existe para o gesto "topo, aceito a proposta".
 */
export function RebalanceApply({
  month,
  changes,
}: {
  month: MonthKey;
  changes: { categoryId: string; limitCents: number }[];
}) {
  const [pending, startTransition] = useTransition();

  function apply() {
    startTransition(async () => {
      const result = await applyBudgetChanges({ month, changes });
      if (result.error) toast.error(result.error);
      else toast.success(`Orçamento do mês ajustado em ${result.applied} categorias.`);
    });
  }

  return (
    <Button size="sm" disabled={pending} onClick={apply}>
      <Check aria-hidden /> Aplicar
    </Button>
  );
}
