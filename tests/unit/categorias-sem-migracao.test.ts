import { describe, expect, it, vi } from "vitest";

/**
 * O app abre mesmo antes da migracao das categorias de receita.
 *
 * O deploy do codigo e o do banco correm separados; com o codigo na frente,
 * ler a coluna `kind` derrubava todas as telas ("Esta tela nao carregou").
 * O que guarda: sem a coluna, as categorias vem todas como de gasto, como
 * eram antes.
 */

const pedidos: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let colunas = "";
      const b: Record<string, unknown> = {};
      b.select = (c: string) => {
        colunas = c;
        pedidos.push(c);
        return b;
      };
      for (const m of ["eq", "order"]) b[m] = () => b;
      b.then = (ok: (r: unknown) => unknown) =>
        Promise.resolve(
          colunas.includes("kind")
            ? { data: null, error: { code: "42703", message: "column categories.kind does not exist" } }
            : {
                data: [{ id: "a", house_id: "c", name: "Alimentação", color: "#f00", icon: null, parent_id: null, is_active: true, excluded_from_totals: false }],
                error: null,
              },
        ).then(ok);
      return b;
    },
  }),
}));

describe("sem a coluna kind", () => {
  it("lê de novo sem ela, e tudo é categoria de gasto", async () => {
    const { listCategories } = await import("@/data/queries");
    const cats = await listCategories("c");
    expect(cats).toEqual([expect.objectContaining({ name: "Alimentação", kind: "expense" })]);
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]).not.toContain("kind");
  });
});
