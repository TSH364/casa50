import Link from "next/link";
import { CircleAlert, Inbox, Radar, ReceiptText, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Aviso } from "@/domain/home";

const ESTILO = {
  passou: { tom: "text-danger", fundo: "bg-danger-soft", Icone: TriangleAlert },
  orcamento: { tom: "text-attention", fundo: "bg-attention-soft", Icone: CircleAlert },
  conta: { tom: "text-brand", fundo: "bg-brand-soft", Icone: ReceiptText },
  radar: { tom: "text-positive", fundo: "bg-positive-soft", Icone: Radar },
  email: { tom: "text-brand", fundo: "bg-brand-soft", Icone: Inbox },
} as const;

/**
 * Um aviso de "Pede atencao", numa linha da lista: o icone e o rotulo dizem
 * o assunto (pela cor e pelo nome), o texto diz o que aconteceu e o link, o
 * que fazer. A cor nunca vai sozinha - o rotulo e o icone dizem o mesmo.
 *
 * O link tem 44px de altura: e o alvo de toque, mesmo sendo texto.
 */
export function AvisoLinha({ aviso }: { aviso: Aviso }) {
  const e = ESTILO[aviso.tipo];
  return (
    <li className="flex gap-3 border-t border-line pt-3 first:border-t-0 first:pt-1">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", e.fundo, e.tom)}>
        <e.Icone className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-legenda font-semibold uppercase tracking-[0.08em]", e.tom)}>{aviso.aba}</p>
        <p className="mt-0.5 text-corpo text-ink">{aviso.texto}</p>
        {aviso.detalhe ? (
          <p className="tabular mt-0.5 truncate text-legenda text-ink-faint">{aviso.detalhe}</p>
        ) : null}
        <Link href={aviso.href} className="inline-flex min-h-11 items-center text-corpo font-semibold text-brand hover:underline">
          {aviso.acao} →
        </Link>
      </div>
    </li>
  );
}
