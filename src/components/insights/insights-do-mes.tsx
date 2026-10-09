import type { Insight } from "@/domain/insights";
import { InsightCard } from "./insight-card";

/**
 * As observacoes do mes em dois blocos: o que pede atencao primeiro, as boas
 * noticias depois. Misturadas pelo peso, uma parcela acabando aparecia entre
 * dois estouros de orcamento, e a lista nao dizia de cara "quantos problemas
 * temos".
 */
export function InsightsDoMes({ insights }: { insights: Insight[] }) {
  const grupos = [
    {
      id: "atencao",
      titulo: "Pede atenção",
      itens: insights.filter((i) => i.tone === "danger" || i.tone === "attention"),
    },
    { id: "boas", titulo: "Boas notícias", itens: insights.filter((i) => i.tone === "positive") },
    { id: "outras", titulo: "Para saber", itens: insights.filter((i) => i.tone === "neutral") },
  ].filter((g) => g.itens.length > 0);

  // Um grupo so: o titulo dele nao acrescenta nada.
  if (grupos.length === 1) {
    return (
      <ul className="space-y-2">
        {insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-4">
      {grupos.map((g) => (
        <section key={g.id} aria-labelledby={`insights-${g.id}`}>
          <h3 id={`insights-${g.id}`} className="mb-2 flex items-baseline gap-2 text-corpo font-medium text-ink">
            {g.titulo}
            <span className="tabular rounded-full bg-surface-2 px-2 py-0.5 text-legenda font-normal text-ink-muted">
              {g.itens.length}
            </span>
          </h3>
          <ul className="space-y-2">
            {g.itens.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
