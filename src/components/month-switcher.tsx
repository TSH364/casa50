"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthLabel } from "@/domain/month";
import { cn } from "@/lib/utils";

/**
 * Troca de mês.
 *
 * O mês vive na URL, não em estado do React. Isso dá três coisas de graça:
 * o botão voltar do navegador funciona, o link pode ser compartilhado, e a
 * página inteira re-renderiza no servidor com Suspense - o que faz os cards
 * caírem em skeleton em vez de mostrarem o total do mês anterior sob o
 * título do mês novo (secao 20).
 *
 * `isPending` desabilita as setas durante a navegação, resolvendo a "troca
 * rápida de mês" que a secao 20 cita: cliques repetidos não empilham.
 */
export function MonthSwitcher({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function go(delta: number) {
    const next = new URLSearchParams(params);
    next.set("mes", addMonths(month, delta));
    startTransition(() => {
      router.push(`${pathname}?${next}`, { scroll: false });
    });
  }

  const label = monthLabel(month).replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => go(-1)}
        disabled={isPending}
        aria-label="Mês anterior"
        className="flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </button>

      <span
        aria-live="polite"
        className={cn(
          "min-w-[9.5rem] text-center text-[15px] font-semibold tracking-tight text-ink transition-opacity",
          isPending && "opacity-50",
        )}
      >
        {label}
      </span>

      <button
        type="button"
        onClick={() => go(1)}
        disabled={isPending}
        aria-label="Próximo mês"
        className="flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <ChevronRight className="size-5" aria-hidden />
      </button>
    </div>
  );
}
