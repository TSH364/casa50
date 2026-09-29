import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * O cartao de ofertas na Conversa: link que abre fora com `noopener`, aviso
 * de preco nao confirmado, "Criar tarefa" como o toque de confirmacao, e
 * link que nao e http(s) nao vira clique.
 */

const pedidos: unknown[] = [];
vi.mock("@/actions/chat", () => ({
  applyProposal: async (p: unknown) => {
    pedidos.push(p);
    return { ok: true, count: 1 };
  },
}));

const { ShoppingCard } = await import("@/components/chat/shopping-card");

const busca = {
  id: "s1",
  query: "air fryer",
  maxPriceCents: null,
  searchedAt: "2026-09-29T17:03:00Z",
  offers: [
    { title: "Air Fryer Mondial 4L", store: "Mercado Livre", priceCents: 34_990, installments: "10x de R$ 34,99", url: "https://produto.mercadolivre.com.br/MLB-1", priceSeen: true },
    { title: "Fritadeira Philco", store: "Amazon", priceCents: 29_900, installments: null, url: "https://amazon.com.br/dp/B0", priceSeen: false },
    { title: "Fechadura Tapo", store: "Amazon", priceCents: 89_900, installments: null, url: "https://www.amazon.com.br/s?k=Fechadura%20Tapo", priceSeen: false, linkKind: "busca" as const },
    { title: "Perigosa", store: "X", priceCents: 100, installments: null, url: "javascript:alert(1)", priceSeen: true },
  ],
};

describe("ShoppingCard", () => {
  it("links seguros, aviso de preço, e criar tarefa com o previsto", async () => {
    render(<ShoppingCard search={busca} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[2]!.textContent).toMatch(/Buscar na loja/);
    expect(screen.getByText(/anúncio não conferido: o link abre a busca da loja/)).toBeTruthy();
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(/à vista · confira o preço na loja/)).toBeTruthy();
    expect(screen.queryByText("Perigosa")).toBeNull();
    expect(screen.getByText(/Preços da busca na web em 29\/09 às 14:03/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /Criar tarefa/ })[0]!);
    expect(await screen.findByText("Tarefa criada")).toBeTruthy();
    expect(pedidos[0]).toEqual({
      kind: "tarefa",
      fields: {
        title: "Comprar Air Fryer Mondial 4L",
        expectedCents: 34_990,
        notes: "Mercado Livre · 10x de R$ 34,99\nhttps://produto.mercadolivre.com.br/MLB-1",
      },
    });
  });
});
