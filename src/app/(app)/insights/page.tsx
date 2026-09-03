import type { Metadata } from "next";
import { Card, CardHeader, InDevelopment } from "@/components/ui/card";

export const metadata: Metadata = { title: "Insights · Fluxo" };

export default function InsightsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Insights</h1>
      <Card>
        <CardHeader
          title="Comparações e alertas"
          description="Cada insight mostra os dados que usou — nunca só a conclusão."
        />
        <InDevelopment note="Etapa 6. Precisa de pelo menos três meses de histórico para comparar." />
      </Card>
    </div>
  );
}
