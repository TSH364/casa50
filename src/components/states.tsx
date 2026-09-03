import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Estados de carregamento, vazio e erro (secao 20).
 *
 * A regra que estes componentes existem para impor: enquanto uma nova
 * consulta esta em voo, a tela mostra `Skeleton` - nunca o numero anterior
 * sob o rotulo novo. Trocar o mes e ver o total do mes passado por um
 * instante e pior do que ver um retangulo cinza.
 */

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton", className)} aria-hidden {...props} />;
}

/** Esqueleto de um valor monetario, na altura do texto que vai substitui-lo. */
export function SkeletonValue({ className }: { className?: string }) {
  return <Skeleton className={cn("h-7 w-28", className)} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[--radius-control] border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] text-ink-faint">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Nao foi possivel carregar",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-[--radius-control] border border-danger/40 bg-danger-soft/40 px-6 py-8 text-center"
    >
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{description}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
