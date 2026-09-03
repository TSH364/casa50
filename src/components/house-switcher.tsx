"use client";

import { useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { selectHouse } from "@/app/casa-actions";
import type { HouseSummary } from "@/lib/houses";

/**
 * Seletor da casa ativa.
 *
 * Com uma casa so, vira apenas o nome - um dropdown de um item unico e
 * ruido. Com mais de uma, usa `<select>` nativo estilizado: no celular ele
 * abre a roleta do sistema, que e mais confortavel que qualquer menu
 * customizado, e continua acessivel por teclado.
 */
export function HouseSwitcher({
  houses,
  activeId,
}: {
  houses: HouseSummary[];
  activeId: string;
}) {
  const [pending, startTransition] = useTransition();
  const active = houses.find((h) => h.id === activeId);

  if (houses.length <= 1) {
    return (
      <span className="truncate text-sm font-medium text-ink">
        {active?.name ?? "Minha casa"}
      </span>
    );
  }

  return (
    <div className="relative min-w-0">
      <select
        aria-label="Casa ativa"
        value={activeId}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(() => {
            void selectHouse(next);
          });
        }}
        className="min-h-11 w-full appearance-none rounded-[--radius-control] bg-transparent py-2 pl-2 pr-8 text-sm font-medium text-ink focus:outline-none disabled:opacity-60"
      >
        {houses.map((house) => (
          <option key={house.id} value={house.id} className="bg-surface-2">
            {house.name}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
    </div>
  );
}
