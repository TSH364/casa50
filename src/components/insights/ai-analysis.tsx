"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CircleAlert, Lightbulb, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { analyzeMonth } from "@/actions/ai-insights";
import type { SavedAiAnalysis } from "@/data/queries";
import { repeteObservacao, type Insight, type InsightTone } from "@/domain/insights";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EvidenciasDaIa } from "./evidencias-ia";
import { plural } from "@/domain/evidencia";

/**
 * A leitura do mes feita por IA (secao 14).
 *
 * Sob demanda, e nunca ao abrir a tela: cada analise e uma chamada paga e
 * leva alguns segundos. A ultima fica guardada, e quem abrir depois ve a
 * mesma, com a data em que foi feita.
 */

const TOM: Record<InsightTone, { border: string; icon: string; soft: string; Icon: typeof TrendingUp }> = {
  positive: { border: "border-l-positive", icon: "text-positive", soft: "bg-positive-soft", Icon: TrendingDown },
  neutral: { border: "border-l-line-strong", icon: "text-ink-muted", soft: "bg-surface-3", Icon: Sparkles },
  attention: { border: "border-l-attention", icon: "text-attention", soft: "bg-attention-soft", Icon: TrendingUp },
  danger: { border: "border-l-danger", icon: "text-danger", soft: "bg-danger-soft", Icon: CircleAlert },
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
  observacoes = [],
}: {
  month: string;
  scope: "casa" | "tudo";
  initial: SavedAiAnalysis | null;
  enabled: boolean;
  /** As observacoes do app na mesma tela: a analise que so as repete sai. */
  observacoes?: Pick<Insight, "fato">[];
}) {
  const [analise, setAnalise] = useState(initial);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // "Alimentacao abaixo da media" aparecia aqui e de novo em O que mudou.
  const itens = analise?.items.filter((a) => !repeteObservacao(a.evidence, observacoes)) ?? [];
  const repetidas = (analise?.items.length ?? 0) - itens.length;

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
          {itens.map((a, i) => {
            const tom = TOM[a.tone];
            return (
              <li key={i} className={cn("rounded-(--radius-control) border-l-2 bg-surface-2 px-3 py-3", tom.border)}>
                <div className="flex items-start gap-2.5">
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", tom.soft)}>
                    <tom.Icon className={cn("size-4", tom.icon)} aria-hidden />
                  </span>
                  <p className="min-w-0 flex-1 pt-1 text-sm font-semibold text-ink">{plural(a.title)}</p>
                </div>
                {/* O texto na largura toda: recuado sob o icone, no celular sobravam cinco palavras por linha. */}
                <p className="mt-1.5 text-corpo text-ink-muted">{plural(a.text)}</p>
                {/* A evidencia vem dos fatos do app, nao do texto da IA - e vira desenho. */}
                <EvidenciasDaIa evidence={a.evidence} tone={a.tone} />
                {a.suggestion ? (
                  <div className="mt-2.5 flex items-start gap-2 rounded-(--radius-control) border border-dashed border-line-strong px-3 py-2">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden />
                    <p className="text-corpo text-ink">
                      <span className="mr-1 font-medium">Sugestão:</span>
                      {plural(a.suggestion)}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {repetidas > 0 ? (
        <p className="mt-2 text-legenda text-ink-faint">
          {repetidas === 1
            ? "1 análise repetia uma observação de O que mudou e ficou de fora."
            : `${repetidas} análises repetiam observações de O que mudou e ficaram de fora.`}
        </p>
      ) : null}

      {analise && analise.dropped > 0 ? (
        <p className="mt-2 text-legenda text-ink-faint">
          {analise.dropped === 1
            ? "1 análise foi descartada porque citava número que não estava nos dados."
            : `${analise.dropped} análises foram descartadas porque citavam números que não estavam nos dados.`}
        </p>
      ) : null}

      {erro ? (
        <p role="alert" className="mt-3 text-corpo text-danger">
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
            <p className="text-legenda text-ink-faint">
              Vai para um modelo pago que não guarda os dados: totais, categorias, lojas e primeiros nomes.
            </p>
          </>
        ) : (
          <p className="text-corpo text-ink-muted">
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
