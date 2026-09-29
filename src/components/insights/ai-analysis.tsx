"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CircleAlert, Lightbulb, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { analyzeMonth } from "@/actions/ai-insights";
import type { SavedAiAnalysis } from "@/data/queries";
import type { InsightTone } from "@/domain/insights";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A leitura do mes feita por IA (secao 14).
 *
 * Sob demanda, e nunca ao abrir a tela: cada analise e uma chamada paga e
 * leva alguns segundos. A ultima fica guardada, e quem abrir depois ve a
 * mesma, com a data em que foi feita.
 */

const TOM: Record<InsightTone, { border: string; icon: string; Icon: typeof TrendingUp }> = {
  positive: { border: "border-l-positive", icon: "text-positive", Icon: TrendingDown },
  neutral: { border: "border-l-line-strong", icon: "text-ink-muted", Icon: Sparkles },
  attention: { border: "border-l-attention", icon: "text-attention", Icon: TrendingUp },
  danger: { border: "border-l-danger", icon: "text-danger", Icon: CircleAlert },
};

const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function AiAnalysisCard({
  month,
  scope,
  initial,
  enabled,
}: {
  month: string;
  scope: "casa" | "tudo";
  initial: SavedAiAnalysis | null;
  enabled: boolean;
}) {
  const [analise, setAnalise] = useState(initial);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function analisar() {
    setErro(null);
    start(async () => {
      const r = await analyzeMonth({ month, scope });
      if (r.error) setErro(r.error);
      else if (r.analysis) setAnalise(r.analysis);
    });
  }

  return (
    <Card aria-busy={pending}>
      <CardHeader
        title="Leitura da IA"
        description={
          analise
            ? `Feita em ${QUANDO.format(new Date(analise.createdAt)).replace(",", " às")}.`
            : "O app calcula os números; a IA liga os pontos. Análise com número que não bate com os dados é descartada."
        }
      />

      {analise ? (
        <ul className="space-y-2">
          {analise.items.map((a, i) => {
            const tom = TOM[a.tone];
            return (
              <li key={i} className={cn("rounded-[--radius-control] border-l-2 bg-surface-2 px-3 py-3", tom.border)}>
                <div className="flex items-start gap-2.5">
                  <tom.Icon className={cn("mt-0.5 size-4 shrink-0", tom.icon)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{a.title}</p>
                    <p className="mt-0.5 text-[13px] text-ink-muted">{a.text}</p>
                    {a.suggestion ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-ink">
                        <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-attention" aria-hidden />
                        <span>{a.suggestion}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
                {/* A evidencia vem dos fatos do app, nao do texto da IA. */}
                <dl className="mt-2.5 space-y-0.5 border-t border-line pt-2">
                  {a.evidence.map((e) => (
                    <div key={e.label} className="flex flex-wrap items-baseline gap-x-1.5">
                      <dt className="text-[12px] text-ink-faint">{e.label}:</dt>
                      <dd className="tabular text-[12px] font-medium text-ink-muted">{e.value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      ) : null}

      {analise && analise.dropped > 0 ? (
        <p className="mt-2 text-[12px] text-ink-faint">
          {analise.dropped === 1
            ? "1 análise foi descartada porque citava número que não estava nos dados."
            : `${analise.dropped} análises foram descartadas porque citavam números que não estavam nos dados.`}
        </p>
      ) : null}

      {erro ? (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {erro}
        </p>
      ) : null}

      <div className={cn(analise || erro ? "mt-4" : null, "space-y-2")}>
        {enabled ? (
          <>
            <Button
              variant={analise ? "secondary" : "default"}
              className="w-full sm:w-auto"
              onClick={analisar}
              disabled={pending}
            >
              <Sparkles aria-hidden />
              {pending ? "Analisando… leva uns 15 segundos" : analise ? "Refazer análise" : "Analisar o mês com IA"}
            </Button>
            <p className="text-[12px] text-ink-faint">
              Vai para um modelo pago que não guarda os dados: totais, categorias, lojas e primeiros nomes.
            </p>
          </>
        ) : (
          <p className="text-[13px] text-ink-muted">
            Para usar, configure a chave de IA em{" "}
            <Link href="/casa" className="text-brand underline-offset-4 hover:underline">
              Casa
            </Link>
            .
          </p>
        )}
      </div>
    </Card>
  );
}
