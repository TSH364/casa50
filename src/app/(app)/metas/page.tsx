import type { Metadata } from "next";
import { Card, CardHeader, InDevelopment } from "@/components/ui/card";

export const metadata: Metadata = { title: "Metas · Fluxo" };

export default function MetasPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Metas</h1>
      <Card>
        <CardHeader
          title="Objetivos e aportes"
          description="Valor-alvo, prazo, aporte mensal e histórico de depósitos."
        />
        <InDevelopment note="Etapa 6. As tabelas goals e goal_deposits já existem no banco." />
      </Card>
    </div>
  );
}
