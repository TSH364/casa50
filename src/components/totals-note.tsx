import Link from "next/link";
import { EyeOff, Eye } from "lucide-react";
import { SHOW_ALL, type HouseView } from "@/lib/house-view";
import type { Category } from "@/domain/types";

/**
 * Aviso de que a tela esta deixando uma categoria de fora.
 *
 * A secao 20 nao permite exibir um numero sem dizer do que ele e feito, e um
 * total que ignora metade do dinheiro sem avisar e exatamente isso. O aviso e
 * discreto mas nunca omitido, e carrega o caminho de volta: a mesma tela,
 * mostrando tudo.
 */
export function TotalsNote({
  view,
  month,
  extraParams,
}: {
  view: HouseView;
  month?: string;
  /** Filtros da tela que precisam sobreviver ao clique (pessoa, cartão). */
  extraParams?: Record<string, string | null | undefined>;
}) {
  if (view.excluded.length === 0) return null;

  const params = new URLSearchParams();
  if (month) params.set("mes", month);
  for (const [k, v] of Object.entries(extraParams ?? {})) {
    if (v) params.set(k, v);
  }
  if (!view.showingAll) params.set("totais", SHOW_ALL);

  const nomes = listar(view.excluded);
  const href = `?${params.toString()}`;

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[--radius-control] bg-surface-2 px-3 py-2 text-[12px] text-ink-faint">
      {view.showingAll ? (
        <>
          <Eye className="size-3.5 shrink-0" aria-hidden />
          <span>
            Mostrando <span className="text-ink-muted">tudo</span>, inclusive{" "}
            {nomes}.
          </span>
          <Link href={href} className="text-brand underline-offset-4 hover:underline">
            Voltar ao gasto da casa
          </Link>
        </>
      ) : (
        <>
          <EyeOff className="size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="text-ink-muted">{nomes}</span>{" "}
            {view.excluded.length === 1 ? "está fora" : "estão fora"} destes
            números.
          </span>
          <Link href={href} className="text-brand underline-offset-4 hover:underline">
            Incluir
          </Link>
        </>
      )}
    </p>
  );
}

/** "TSH", "TSH e Empresa", "A, B e C". */
function listar(categories: Category[]): string {
  const nomes = categories.map((c) => c.name);
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}
