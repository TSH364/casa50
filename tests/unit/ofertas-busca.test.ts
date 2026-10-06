import { describe, expect, it, vi } from "vitest";

/**
 * O que a busca de ofertas manda para o buscador.
 *
 * O plugin de busca do OpenRouter passa o texto da mensagem do usuario direto
 * para a Exa. Com o pedido inteiro nessa mensagem ("Pesquise ofertas...
 * Priorize Mercado Livre... responda em JSON"), o Radar achava artigos sobre
 * monitorar preco no Mercado Livre - e nenhum anuncio. O que guarda: a
 * mensagem do usuario e so o produto; as instrucoes vao no sistema.
 */

const chamadas: { messages: { role: string; content: string }[] }[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openrouter", () => ({
  webSearch: async (messages: { role: string; content: string }[]) => {
    chamadas.push({ messages });
    return { content: '{"ofertas":[]}', citations: [], servedBy: "m", costUsd: 0.01 };
  },
}));

const { buscarOfertas } = await import("@/lib/ofertas");

describe("o que vai para o buscador", () => {
  it("a mensagem do usuário é só o produto; o pedido e o formato vão no sistema", async () => {
    await buscarOfertas("  Ninja   Creami ", 150_000, { apiKey: "k", timeoutMs: 1000 });
    const [{ messages }] = chamadas as [{ messages: { role: string; content: string }[] }];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]!.content).toBe("Ninja Creami preço comprar Brasil");
    expect(messages[1]!.content).not.toMatch(/Mercado Livre|JSON/);
    expect(messages[0]!.content).toMatch(/Ninja Creami/);
    expect(messages[0]!.content).toMatch(/R\$ 1500,00/);
    expect(messages[0]!.content).toMatch(/JSON/);
  });
});
