"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, ListPlus, ShoppingBag } from "lucide-react";
import { applyProposal } from "@/actions/chat";
import type { ShoppingSearch } from "@/domain/shopping";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";

/**
 * As ofertas de uma pesquisa de compra (secao 16).
 *
 * O link e a pagina que a busca abriu (ver `checkOffers`), e o cartao diz
 * sempre que o preco e da busca: pagina de loja muda de preco a toda hora.
 * "Criar tarefa" e o toque de confirmacao - vai para `applyProposal`, que
 * confere tudo de novo no servidor, como as outras propostas da conversa.
 */

const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function ShoppingCard({ search }: { search: ShoppingSearch }) {
  const [feitas, setFeitas] = useState<Record<string, true>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function criarTarefa(i: number) {
    const o = search.offers[i]!;
    setErro(null);
    start(async () => {
      const r = await applyProposal({
        kind: "tarefa",
        fields: {
          title: `Comprar ${o.title}`.slice(0, 200),
          expectedCents: o.priceCents,
          notes: `${o.store}${o.installments ? ` · ${o.installments}` : ""}\n${o.url}`,
        },
      });
      if (r.error) setErro(r.error);
      else setFeitas((f) => ({ ...f, [o.url]: true }));
    });
  }

  return (
    <div className="mt-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-corpo text-ink">
      <p className="flex items-center gap-1.5 font-medium">
        <ShoppingBag className="size-4 shrink-0 text-ink-muted" aria-hidden />
        <span className="min-w-0 break-words">Pesquisa: {search.query}</span>
      </p>

      {search.offers.length === 0 ? (
        <p className="mt-1 text-legenda text-ink-muted">Nenhuma oferta com preço e link conferidos.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {/* So http(s): a lista volta do armazenamento do aparelho, e um link
              "javascript:" gravado ali nao pode virar clique. */}
          {search.offers.map((o, i) => /^https?:\/\//i.test(o.url) && (
            <li key={o.url} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-legenda font-medium text-ink-muted">{o.store}</span>
                <span className="tabular shrink-0 text-sm font-semibold text-ink">{formatCents(o.priceCents)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 break-words text-corpo text-ink">{o.title}</p>
              <p className="mt-0.5 text-legenda text-ink-muted">
                {o.installments ?? "à vista"}
                {o.linkKind === "busca"
                  ? " · anúncio não conferido: o link abre a busca da loja"
                  : o.priceSeen
                    ? ""
                    : " · confira o preço na loja"}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <a
                  href={o.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line-strong px-3 text-corpo text-ink transition-colors hover:bg-surface-2"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  {o.linkKind === "busca" ? "Buscar na loja" : "Abrir na loja"}
                  <span className="sr-only"> (abre em outra aba)</span>
                </a>
                {feitas[o.url] ? (
                  <span className="inline-flex min-h-9 items-center gap-1.5 text-corpo text-positive">
                    <Check className="size-3.5" aria-hidden /> Tarefa criada
                  </span>
                ) : (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => criarTarefa(i)}>
                    <ListPlus aria-hidden /> Criar tarefa
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {erro ? (
        <p role="alert" className="mt-1.5 text-legenda text-danger">
          {erro}
        </p>
      ) : null}
      <p className="mt-2 text-legenda text-ink-muted">
        Preços da busca na web em {QUANDO.format(new Date(search.searchedAt)).replace(",", " às")}. Confira na loja antes de
        comprar.
      </p>
    </div>
  );
}
