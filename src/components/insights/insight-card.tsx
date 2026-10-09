import Link from "next/link";
import {
  ArrowRight,
  CircleAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/money";
import type { Insight, InsightMedida, InsightTone } from "@/domain/insights";

/** Uma observacao do app, com os numeros que a sustentam (secao 14). */

const TONE: Record<
  InsightTone,
  { border: string; icon: string; Icon: typeof TrendingUp; excesso: string; pill: string }
> = {
  positive: {
    border: "border-l-positive",
    icon: "text-positive",
    Icon: TrendingDown,
    excesso: "bg-positive",
    pill: "bg-positive-soft text-positive",
  },
  neutral: {
    border: "border-l-line-strong",
    icon: "text-ink-muted",
    Icon: Sparkles,
    excesso: "bg-ink-muted",
    pill: "bg-surface-3 text-ink-muted",
  },
  attention: {
    border: "border-l-attention",
    icon: "text-attention",
    Icon: TrendingUp,
    excesso: "bg-attention",
    pill: "bg-attention-soft text-attention",
  },
  danger: {
    border: "border-l-danger",
    icon: "text-danger",
    Icon: CircleAlert,
    excesso: "bg-danger",
    pill: "bg-danger-soft text-danger",
  },
};

/** A diferenca escrita, para a cor nunca ser o unico sinal. */
function diferenca(insight: Insight, m: InsightMedida): string {
  if (insight.kind === "budget_over" || insight.kind === "budget_warning") {
    return `${Math.round((m.atualCents / m.referenciaCents) * 100)}% do limite`;
  }
  const d = m.atualCents - m.referenciaCents;
  const pct = m.referenciaCents > 0 ? Math.round((Math.abs(d) / m.referenciaCents) * 100) : null;
  return `${d >= 0 ? "+" : "−"}${formatCents(Math.abs(d))}${pct !== null ? ` · ${pct}%` : ""}`;
}

/**
 * O mes contra a referencia, numa barra so.
 *
 * O cinza vai ate onde as duas coincidem; o pedaco que passou da referencia
 * ganha a cor do aviso, e o que ficou abaixo dela aparece tracejado. Um
 * traco marca a referencia. Atencao e perigo tem cores proximas no tema
 * claro (a conferencia de daltonismo nao separa as duas): por isso o tipo
 * do aviso fica no icone, no titulo e na diferenca escrita - a barra so
 * mostra o tamanho.
 */
export function MedidaBar({ insight, medida: m }: { insight: Insight; medida: InsightMedida }) {
  const tone = TONE[insight.tone];
  const escala = Math.max(m.atualCents, m.referenciaCents, 1);
  const pct = (c: number) => `${(c / escala) * 100}%`;
  const base = Math.min(m.atualCents, m.referenciaCents);
  const passou = m.atualCents > m.referenciaCents;
  // Gasto menor que a media e boa noticia; o que cabe no orcamento e so espaco.
  const sobraBoa = insight.tone === "positive";

  return (
    <div className="mt-2.5">
      <div
        className="relative h-2.5"
        role="img"
        aria-label={`${m.atualRotulo}: ${formatCents(m.atualCents)}; ${m.referenciaRotulo}: ${formatCents(m.referenciaCents)}`}
        title={`${m.atualRotulo} ${formatCents(m.atualCents)} · ${m.referenciaRotulo} ${formatCents(m.referenciaCents)}`}
      >
        <div className="absolute inset-0 rounded-full bg-surface-3" />
        {base > 0 ? (
          <span
            className={cn("absolute inset-y-0 left-0 bg-ink-faint/70", passou ? "rounded-l-full" : "rounded-full")}
            style={{ width: pct(base) }}
          />
        ) : null}
        {passou ? (
          // 2px de folga entre o cinza e o excesso: dois pedacos, nao um so.
          <span
            className={cn("absolute inset-y-0 rounded-r-full", tone.excesso)}
            style={{ left: `calc(${pct(m.referenciaCents)} + 2px)`, right: 0 }}
          />
        ) : m.atualCents < m.referenciaCents ? (
          <span
            className={cn(
              "absolute inset-y-0 rounded-r-full border border-dashed",
              sobraBoa ? "border-positive bg-positive-soft" : "border-line-strong",
            )}
            style={{ left: `calc(${pct(m.atualCents)} + 2px)`, right: 0 }}
          />
        ) : null}
        {/* O traco da referencia, um pouco maior que a barra. */}
        <span
          aria-hidden
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
          style={{ left: pct(m.referenciaCents) }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-legenda">
        <span className="min-w-0 text-ink-muted">
          {m.atualRotulo} <span className="tabular font-medium text-ink">{formatCents(m.atualCents)}</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5 text-ink-faint">
          <span className="inline-block h-2.5 w-0.5 translate-y-px rounded-full bg-ink" aria-hidden />
          {m.referenciaRotulo} <span className="tabular text-ink-muted">{formatCents(m.referenciaCents)}</span>
        </span>
      </div>
    </div>
  );
}

export function InsightCard({ insight }: { insight: Insight }) {
  const tone = TONE[insight.tone];
  const m = insight.medida;
  const body = (
    <>
      <div className="flex items-start gap-2.5">
        <tone.Icon className={cn("mt-0.5 size-4 shrink-0", tone.icon)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-ink">{insight.title}</p>
            {m ? (
              <span className={cn("tabular shrink-0 rounded-full px-2 py-0.5 text-legenda font-medium", tone.pill)}>
                {diferenca(insight, m)}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-corpo text-ink-muted">{insight.detail}</p>
          {m ? <MedidaBar insight={insight} medida={m} /> : null}
        </div>
        {insight.href ? (
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
        ) : null}
      </div>

      {/*
        A evidência é o ponto do insight, não um detalhe opcional: a secao 14
        proíbe mostrar a conclusão sem os números que a sustentam. Com a
        barra, os números já estão nela (o mês, a referência e a diferença).
      */}
      {m ? null : (
        <dl className="mt-2.5 ml-6.5 grid gap-y-1 border-t border-line pt-2">
          {insight.evidence.map((e) => (
            <div key={e.label} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt className="min-w-0 text-legenda text-ink-faint">{e.label}</dt>
              <dd className="tabular ml-auto text-right text-legenda font-medium text-ink-muted">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );

  const className = cn(
    "block rounded-(--radius-control) border-l-2 bg-surface-2 px-3 py-3 text-left",
    tone.border,
    insight.href && "transition-colors hover:bg-surface-3",
  );

  return insight.href ? (
    <li>
      <Link href={insight.href} className={className}>
        {body}
      </Link>
    </li>
  ) : (
    <li className={className}>{body}</li>
  );
}
