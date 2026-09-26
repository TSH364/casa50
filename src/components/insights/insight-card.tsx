import Link from "next/link";
import {
  ArrowRight,
  CircleAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Insight, InsightTone } from "@/domain/insights";

/** Uma observacao do app, com os numeros que a sustentam (secao 14). */

const TONE: Record<
  InsightTone,
  { border: string; icon: string; Icon: typeof TrendingUp }
> = {
  positive: {
    border: "border-l-positive",
    icon: "text-positive",
    Icon: TrendingDown,
  },
  neutral: { border: "border-l-line-strong", icon: "text-ink-muted", Icon: Sparkles },
  attention: {
    border: "border-l-attention",
    icon: "text-attention",
    Icon: TrendingUp,
  },
  danger: { border: "border-l-danger", icon: "text-danger", Icon: CircleAlert },
};

export function InsightCard({ insight }: { insight: Insight }) {
  const tone = TONE[insight.tone];
  const body = (
    <>
      <div className="flex items-start gap-2.5">
        <tone.Icon className={cn("mt-0.5 size-4 shrink-0", tone.icon)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{insight.title}</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">{insight.detail}</p>
        </div>
        {insight.href ? (
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
        ) : null}
      </div>

      {/*
        A evidência é o ponto do insight, não um detalhe opcional: a secao 14
        proíbe mostrar a conclusão sem os números que a sustentam.
      */}
      <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2">
        {insight.evidence.map((e) => (
          <div key={e.label} className="flex items-baseline gap-1.5">
            <dt className="text-[12px] text-ink-faint">{e.label}:</dt>
            <dd className="tabular text-[12px] font-medium text-ink-muted">
              {e.value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );

  const className = cn(
    "block rounded-[--radius-control] border-l-2 bg-surface-2 px-3 py-3 text-left",
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
