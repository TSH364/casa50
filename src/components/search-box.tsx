"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/field";

/**
 * Busca por descrição, estabelecimento ou apelido.
 *
 * O termo vai para a URL com 350ms de atraso: sem isso cada tecla dispararia
 * uma navegação e uma consulta ao banco. O valor exibido é estado local, para
 * o campo não "engasgar" enquanto a navegação acontece.
 */
export function SearchBox({ placeholder = "Buscar…" }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(params.get("busca") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function push(term: string) {
    const next = new URLSearchParams(params);
    if (term.trim() === "") next.delete("busca");
    else next.set("busca", term.trim());
    startTransition(() => {
      router.push(`${pathname}?${next}`, { scroll: false });
    });
  }

  function onChange(term: string) {
    setValue(term);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => push(term), 350);
  }

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
      <Input
        type="search"
        aria-label="Buscar lançamentos"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 pr-9"
      />
      {value ? (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => {
            setValue("");
            clearTimeout(timer.current);
            push("");
          }}
          className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint hover:bg-surface-3 hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
