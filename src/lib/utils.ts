import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * O tailwind-merge so conhece os tamanhos de texto padrao (`text-sm`...).
 * Sem isto, `text-legenda text-ink-muted` era lido como duas CORES em
 * conflito, e o tamanho sumia em silencio - a escala do app (globals.css)
 * precisa estar declarada aqui tambem.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["legenda", "corpo", "destaque", "titulo", "numero", "principal"] }],
    },
  },
});

/** Junta classes resolvendo conflitos do Tailwind (a ultima vence). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
