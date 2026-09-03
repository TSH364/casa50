"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export interface ChipOption {
  value: string;
  label: string;
}

/**
 * Filtro em chips roláveis (membro, cartão).
 *
 * Os nomes vêm sempre de `profiles` - a secao 4 proíbe nome fixo em código,
 * e "Todos" é a única string literal aqui.
 */
export function FilterChips({
  param,
  options,
  active,
  allLabel = "Todos",
  label,
}: {
  /** Nome do parâmetro na URL, ex.: "membro". */
  param: string;
  options: ChipOption[];
  active: string | null;
  allLabel?: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function select(value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(param);
    else next.set(param, value);
    startTransition(() => {
      router.push(`${pathname}?${next}`, { scroll: false });
    });
  }

  if (options.length === 0) return null;

  const items: (ChipOption & { key: string })[] = [
    { key: "__all", value: "", label: allLabel },
    ...options.map((o) => ({ ...o, key: o.value })),
  ];

  return (
    <div
      role="group"
      aria-label={label}
      // Rola no celular sem barra visível, em vez de quebrar em duas linhas.
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const isActive = item.key === "__all" ? active === null : active === item.value;
        return (
          <button
            key={item.key}
            type="button"
            disabled={isPending}
            aria-pressed={isActive}
            onClick={() => select(item.key === "__all" ? null : item.value)}
            className={cn(
              "min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] transition-colors disabled:opacity-50",
              isActive
                ? "border-brand bg-brand-soft text-ink"
                : "border-line bg-surface-2 text-ink-muted hover:text-ink",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
