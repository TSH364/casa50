import Link from "next/link";
import { SHOW_ALL, type HouseView } from "@/lib/house-view";
import type { Category } from "@/domain/types";

/**
 * A chave que liga e desliga o que nao e gasto da casa.
 *
 * Comecou como um aviso com um link no fim da frase - correto e discreto
 * demais. Quem usa pediu uma CHAVE, na tela inicial: "aperto e ele ativa tudo;
 * solto e ele deixa a minha predefinicao, so com os itens que eu quero ver".
 * Uma frase com link se le; uma chave se opera, e esta e uma lente que se troca
 * varias vezes ao dia.
 *
 * O aviso continua junto, e nao vira legenda da chave por acaso: a secao 20 nao
 * permite exibir um numero sem dizer do que ele e feito, e um total que ignora
 * metade do dinheiro sem avisar e exatamente isso. A chave diz o MODO; a linha
 * de baixo diz o EFEITO, com o nome da categoria que esta fora.
 *
 * Continua sendo a URL que guarda o estado, e nao uma preferencia gravada:
 * e lente, nao configuracao - some quando a pessoa sai da tela, e a marca na
 * categoria continua sendo a predefinicao a que tudo volta.
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
  const ligado = view.showingAll;

  return (
    <div className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5">
      {/*
        É um link, e não um botão com estado no cliente: o recorte mora na URL,
        então ele sobrevive a recarregar a página e pode ser compartilhado. Leva
        `role="switch"` para o leitor de tela anunciar ligado/desligado, e o
        texto ao lado repete o modo - nada depende só do widget nem só da cor.
      */}
      <Link
        href={`?${params.toString()}`}
        role="switch"
        aria-checked={ligado}
        aria-label={
          ligado
            ? `Mostrando tudo. Tocar para ver só o gasto da casa, sem ${nomes}.`
            : `Mostrando só o gasto da casa. Tocar para incluir ${nomes}.`
        }
        // A área de toque tem 44px de altura; o trilho desenhado tem 24px e
        // fica centrado nela. Alvo pequeno numa chave que se usa todo dia é
        // erro de toque garantido.
        className="group flex h-11 shrink-0 items-center"
      >
        <span
          className={
            ligado
              ? "relative block h-6 w-11 rounded-full bg-brand transition-colors"
              : "relative block h-6 w-11 rounded-full border border-line-strong bg-surface-3 transition-colors"
          }
        >
          <span
            className={
              ligado
                ? "absolute left-[22px] top-[3px] size-[18px] rounded-full bg-canvas transition-all"
                : "absolute left-[3px] top-[2px] size-[18px] rounded-full bg-ink-faint transition-all"
            }
            aria-hidden
          />
        </span>
      </Link>

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-ink">
          {ligado ? "Mostrando tudo" : "Só o gasto da casa"}
        </span>
        <span className="mt-0.5 block break-words text-[12px] text-ink-faint">
          {ligado ? (
            <>
              <span className="text-ink-muted">{nomes}</span>{" "}
              {view.excluded.length === 1 ? "entra" : "entram"} nestes números.
            </>
          ) : (
            <>
              <span className="text-ink-muted">{nomes}</span>{" "}
              {view.excluded.length === 1 ? "está fora" : "estão fora"} destes
              números.
            </>
          )}
        </span>
      </span>
    </div>
  );
}

/** "TSH", "TSH e Empresa", "A, B e C". */
function listar(categories: Category[]): string {
  const nomes = categories.map((c) => c.name);
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}
