"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import {
  addMonths,
  currentMonth,
  monthLabel,
  monthShortLabel,
} from "@/domain/month";
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
 *
 * As setas servem para andar de um em um; o nome do mês abre a grade, porque
 * voltar de setembro a janeiro na seta são oito toques.
 */
export function MonthSwitcher({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  /** Ano folheado dentro da grade, que não muda o mês até escolher. */
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));

  function goTo(next: string) {
    const params2 = new URLSearchParams(params);
    params2.set("mes", next);
    startTransition(() => {
      router.push(`${pathname}?${params2}`, { scroll: false });
    });
  }

  const label = monthLabel(month).replace(/^./, (c) => c.toUpperCase());
  const thisMonth = currentMonth();

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => goTo(addMonths(month, -1))}
        disabled={isPending}
        aria-label="Mês anterior"
        className="flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => {
          setYear(Number(month.slice(0, 4)));
          setOpen(true);
        }}
        disabled={isPending}
        aria-label={`${label}. Escolher outro mês`}
        className={cn(
          "min-h-11 min-w-[9.5rem] rounded-[--radius-control] px-2 text-center",
          "text-[15px] font-semibold tracking-tight text-ink transition-colors",
          "hover:bg-surface-2 disabled:opacity-40",
          isPending && "opacity-50",
        )}
      >
        {label}
      </button>

      <button
        type="button"
        onClick={() => goTo(addMonths(month, 1))}
        disabled={isPending}
        aria-label="Próximo mês"
        className="flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <ChevronRight className="size-5" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Escolher mês" className="sm:max-w-sm">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              aria-label="Ano anterior"
              className="flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <span aria-live="polite" className="tabular text-lg font-semibold text-ink">
              {year}
            </span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              aria-label="Próximo ano"
              className="flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {Array.from({ length: 12 }, (_, i) => {
              const value = `${year}-${String(i + 1).padStart(2, "0")}`;
              const isSelected = value === month;
              const isCurrent = value === thisMonth;
              return (
                <button
                  key={value}
                  type="button"
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => {
                    goTo(value);
                    setOpen(false);
                  }}
                  className={cn(
                    "min-h-12 rounded-[--radius-control] border text-sm capitalize transition-colors",
                    isSelected
                      ? "border-brand bg-brand-soft font-medium text-ink"
                      : "border-line bg-surface-2 text-ink-muted hover:text-ink",
                    // O mês corrente ganha uma marca discreta: é a âncora para
                    // se localizar depois de folhear alguns anos.
                    !isSelected && isCurrent && "border-line-strong text-ink",
                  )}
                >
                  {monthShortLabel(value)}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex gap-2">
            <DialogClose
              type="button"
              className="min-h-11 flex-1 rounded-[--radius-control] border border-line-strong text-sm text-ink transition-colors hover:bg-surface-2"
            >
              Cancelar
            </DialogClose>
            <button
              type="button"
              onClick={() => {
                goTo(thisMonth);
                setOpen(false);
              }}
              className="min-h-11 flex-1 rounded-[--radius-control] bg-surface-2 text-sm text-ink transition-colors hover:bg-surface-3"
            >
              Mês atual
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
