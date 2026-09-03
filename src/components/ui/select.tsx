import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Select nativo, estilizado.
 *
 * A secao 2 pede para evitar "selects nativos pequenos" - o problema é o
 * tamanho, não o elemento. Com 44px de altura e 16px de fonte, o nativo é
 * melhor que qualquer menu customizado no celular: abre a roleta do sistema,
 * funciona com teclado e com leitor de tela sem trabalho extra.
 *
 * `text-base` evita o zoom automático do Safari ao focar.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    options: readonly SelectOption[];
    placeholder?: string;
  }
>(({ className, options, placeholder, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "min-h-11 w-full appearance-none rounded-[--radius-control] border border-line bg-surface-2",
        "px-3 pr-9 text-base text-ink transition-colors",
        "focus:border-brand focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    >
      {placeholder ? (
        <option value="" className="bg-surface-2">
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-surface-2">
          {option.label}
        </option>
      ))}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
      aria-hidden
    />
  </div>
));
Select.displayName = "Select";
