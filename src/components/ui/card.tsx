import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-(--radius-card) border border-line bg-surface p-4 sm:p-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  action,
  description,
  nivel = 2,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** 3 quando o cartao fica sob um titulo de grupo (o "O mes em detalhe" do Inicio). */
  nivel?: 2 | 3;
}) {
  const Titulo = nivel === 3 ? "h3" : "h2";
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Titulo className="text-destaque font-semibold tracking-tight text-ink">{title}</Titulo>
        {description ? (
          <p className="mt-0.5 text-corpo text-ink-faint">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * Selo para funcionalidade ainda nao construida.
 * A secao 27 pede que isso apareca na interface, e nao que a tela finja
 * funcionar com dado inventado.
 */
export function InDevelopment({ note }: { note?: string }) {
  return (
    <div className="rounded-(--radius-control) border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-center">
      <p className="text-corpo font-medium text-attention">Em desenvolvimento</p>
      {note ? <p className="mt-1 text-corpo text-ink-faint">{note}</p> : null}
    </div>
  );
}
