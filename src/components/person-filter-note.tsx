import Link from "next/link";
import type { Card } from "@/domain/types";

/**
 * O que o filtro por pessoa NAO alcanca, dito na tela.
 *
 * Dois casos, e os dois ja enganaram:
 *
 *   - cartao sem dono: o lancamento que ninguem marcou segue o dono do
 *     cartao; sem dono, ele so aparece em "Todos". Sem este aviso, o filtro
 *     de cada um parece simplesmente incompleto.
 *   - paineis da casa toda (contas fixas e orcamentos): orcamento e limite da
 *     casa, e cortado por pessoa deixaria de ser comparavel com o limite.
 *     Ficam como estao, e a tela diz isso em vez de ignorar o filtro calada.
 *     O mapa de fluxo SEGUE o filtro (a pedido de quem usa).
 */
export function PersonFilterNote({
  cards,
  houseWidePanels,
}: {
  cards: Card[];
  houseWidePanels: boolean;
}) {
  const semDono = cards.filter((c) => c.isActive && c.ownerId === null).length;
  if (semDono === 0 && !houseWidePanels) return null;

  return (
    <p className="text-[12px] text-ink-faint">
      {semDono > 0 ? (
        <>
          {semDono === 1 ? "1 cartão sem dono" : `${semDono} cartões sem dono`}: o que ninguém
          marcou neles só aparece em Todos.{" "}
          <Link href="/cartoes" className="text-brand underline underline-offset-2">
            Definir em Cartões
          </Link>
          {houseWidePanels ? ". " : "."}
        </>
      ) : null}
      {houseWidePanels ? "Contas fixas e orçamentos são sempre da casa toda." : null}
    </p>
  );
}
