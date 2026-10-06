import Link from "next/link";
import { CircleAlert, Radar, ReceiptText, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Aviso } from "@/domain/home";

const ESTILO = {
  passou: { aba: "bg-danger-fill text-white", icone: "text-danger", Icone: TriangleAlert },
  orcamento: { aba: "bg-attention text-canvas", icone: "text-attention", Icone: CircleAlert },
  conta: { aba: "bg-brand text-on-brand", icone: "text-brand", Icone: ReceiptText },
  radar: { aba: "bg-positive text-canvas", icone: "text-positive", Icone: Radar },
} as const;

/**
 * Aviso com aba: a aba diz o assunto (pela cor e pelo nome), o corpo diz o
 * que aconteceu e o que fazer. A cor nunca vai sozinha - o nome da aba e o
 * icone dizem o mesmo.
 */
export function AvisoAba({ aviso }: { aviso: Aviso }) {
  const e = ESTILO[aviso.tipo];
  return (
    <article className="relative pt-[34px]">
      <p
        className={cn(
          "absolute left-1/2 top-0 flex h-9 w-3/5 -translate-x-1/2 items-center justify-center rounded-t-xl text-legenda font-bold uppercase tracking-[0.1em]",
          e.aba,
        )}
      >
        {aviso.aba}
      </p>
      <div className="relative flex min-h-[88px] items-center gap-3.5 rounded-[18px] border border-line bg-surface px-4 shadow-[0_8px_24px_rgba(20,23,40,0.08)]">
        <e.Icone className={cn("size-7 shrink-0", e.icone)} strokeWidth={1.6} aria-hidden />
        <span className="h-12 w-px shrink-0 bg-line" aria-hidden />
        <div className="min-w-0 space-y-1 py-3">
          <p className="text-corpo text-ink">{aviso.texto}</p>
          <Link href={aviso.href} className="text-corpo font-semibold text-brand hover:underline">
            {aviso.acao} →
          </Link>
        </div>
      </div>
      <span
        className={cn("absolute left-1/2 top-[29px] size-3 -translate-x-1/2 rotate-45 rounded-[2px]", e.aba)}
        aria-hidden
      />
    </article>
  );
}
