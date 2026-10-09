"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Tudo / Saidas / Entradas, sempre a vista no topo da lista.
 *
 * Nao mora no "Filtros" (pessoa, cartao, categoria) de proposito: e a
 * pergunta mais comum da tela - "o que saiu?", "o que entrou?" - e esconder
 * atras de um toque a deixava sem resposta. Cada opcao diz quantos tem, para
 * a casa saber antes de tocar.
 */
export function FiltroTipo({
  ativo,
  contagem,
}: {
  ativo: "saida" | "entrada" | null;
  contagem: { tudo: number; saidas: number; entradas: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function escolher(valor: "saidas" | "entradas" | null) {
    const next = new URLSearchParams(params);
    if (valor === null) next.delete("tipo");
    else next.set("tipo", valor);
    startTransition(() => router.push(`${pathname}?${next}`, { scroll: false }));
  }

  const opcoes = [
    { valor: null, rotulo: "Tudo", n: contagem.tudo, on: ativo === null, cor: "" },
    { valor: "saidas" as const, rotulo: "Saídas", n: contagem.saidas, on: ativo === "saida", cor: "text-danger" },
    { valor: "entradas" as const, rotulo: "Entradas", n: contagem.entradas, on: ativo === "entrada", cor: "text-info" },
  ];

  return (
    <div role="radiogroup" aria-label="Mostrar" className="grid grid-cols-3 gap-1 rounded-(--radius-control) bg-surface-2 p-1">
      {opcoes.map((o) => (
        <button
          key={o.rotulo}
          type="button"
          role="radio"
          aria-checked={o.on}
          disabled={pending}
          onClick={() => escolher(o.valor)}
          className={cn(
            "flex min-h-9 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-4px)] text-corpo transition-colors disabled:opacity-60",
            o.on ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          <span className={cn(o.on && o.cor)}>{o.rotulo}</span>
          <span className="tabular text-legenda text-ink-faint">{o.n}</span>
        </button>
      ))}
    </div>
  );
}
