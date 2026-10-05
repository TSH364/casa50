import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { categoriasDoLado, ladoDoTipo } from "@/domain/categorias";
import { buildSystemPrompt } from "@/domain/chat";
import type { Category } from "@/domain/types";

/**
 * Categorias de receita separadas das de gasto - pedido da casa: "quando a
 * gente lanca uma receita, as categorias deveriam ser diferentes: salario,
 * pro-labore...".
 *
 * O que guarda: receita oferece so as de receita e gasto so as de gasto; o
 * que o lancamento ja tem nao some do seletor; trocar o tipo limpa a
 * categoria do outro lado; a Dor.IA recebe as duas listas separadas; e o
 * banco semeia as de receita nas casas que existem e nas novas.
 */

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/transactions", () => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  setTransactionCategory: vi.fn(),
}));
vi.mock("@/actions/jev", () => ({ suggestCategoryFromText: vi.fn(async () => ({})) }));

function cat(id: string, name: string, kind: "expense" | "income", parentId: string | null = null): Category {
  return { id, houseId: "c", name, color: "#888", icon: null, parentId, isActive: true, kind, excludedFromTotals: false };
}

const CATS = [
  cat("ali", "Alimentação", "expense"),
  cat("mercado", "Mercado", "expense", "ali"),
  cat("lazer", "Lazer", "expense"),
  cat("salario", "Salário", "income"),
  cat("bolsa", "Bolsa", "income"),
  cat("fapesp", "FAPESP", "income", "bolsa"),
];

const nomes = (cs: Category[]) => cs.map((c) => c.name);

describe("de que lado", () => {
  it("receita usa as de receita; todo o resto, as de gasto", () => {
    expect(ladoDoTipo("income")).toBe("income");
    for (const t of ["expense", "refund", "fee", "payment", "adjustment"]) expect(ladoDoTipo(t)).toBe("expense");
    expect(nomes(categoriasDoLado(CATS, "income"))).toEqual(["Salário", "Bolsa", "FAPESP"]);
    expect(nomes(categoriasDoLado(CATS, "expense"))).toEqual(["Alimentação", "Mercado", "Lazer"]);
  });

  it("o que o lançamento já tem fica, com a mãe, mesmo do outro lado", () => {
    // Receita antiga marcada em Alimentacao > Mercado, antes de existir categoria de receita.
    expect(nomes(categoriasDoLado(CATS, "income", ["ali", "mercado"]))).toEqual([
      "Alimentação",
      "Mercado",
      "Salário",
      "Bolsa",
      "FAPESP",
    ]);
    expect(nomes(categoriasDoLado(CATS, "income", [null, undefined]))).toEqual(["Salário", "Bolsa", "FAPESP"]);
  });
});

describe("formulário de lançamento", () => {
  async function abrir() {
    const { TransactionFormDialog } = await import("@/components/transactions/transaction-form");
    render(<TransactionFormDialog open onOpenChange={() => {}} categories={CATS} cards={[]} members={[]} defaultMonth="2026-09" />);
  }
  const opcoes = () =>
    [...(screen.getByLabelText("Categoria") as HTMLSelectElement).options].map((o) => o.text).filter((t) => t !== "Sem categoria");

  it("gasto mostra as de gasto; receita, as de receita", async () => {
    await abrir();
    expect(opcoes()).toEqual(["Alimentação", "Lazer"]);
    fireEvent.click(screen.getByRole("radio", { name: "Receita" }));
    expect(opcoes()).toEqual(["Salário", "Bolsa"]);
    // Subcategoria de receita tambem.
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "bolsa" } });
    expect([...(screen.getByLabelText("Subcategoria") as HTMLSelectElement).options].map((o) => o.text)).toContain("FAPESP");
  });

  it("trocar o tipo limpa a categoria do outro lado", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "lazer" } });
    fireEvent.click(screen.getByRole("radio", { name: "Receita" }));
    expect((screen.getByLabelText("Categoria") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "salario" } });
    // Voltar para receita nao mexe; "Outro" (estorno, tarifa...) e do lado do gasto.
    fireEvent.click(screen.getByRole("radio", { name: "Receita" }));
    expect((screen.getByLabelText("Categoria") as HTMLSelectElement).value).toBe("salario");
    fireEvent.click(screen.getByRole("radio", { name: "Outro" }));
    expect((screen.getByLabelText("Categoria") as HTMLSelectElement).value).toBe("");
  });
});

describe("Dor.IA", () => {
  it("recebe as categorias de gasto e as de receita separadas", () => {
    const p = buildSystemPrompt({
      houseName: "Casa 50",
      today: "05/10/2026",
      currentMonth: "2026-10",
      members: ["Vini", "Lari"],
      categories: ["Alimentação", "Lazer"],
      incomeCategories: ["Salário", "Bolsa"],
      excludedCategories: [],
      monthsWithData: [],
      snapshot: null,
    });
    expect(p).toContain("- Categorias: Alimentação; Lazer.");
    expect(p).toContain("- Categorias de receita (só para dinheiro que entrou): Salário; Bolsa.");
  });
});

describe("banco", () => {
  const sql = readFileSync("supabase/migrations/20261005000001_categorias_de_receita.sql", "utf8");

  it("semeia as de receita nas casas que existem e nas novas, sem mexer nas de gasto", () => {
    expect(sql).toMatch(/add column if not exists kind text not null default 'expense'/);
    const iniciais = ["Salário", "Pró-labore", "Bolsa", "Freelas", "Rendimentos", "Outras receitas"];
    const casaNova = sql.slice(sql.indexOf("create or replace function app.bootstrap_house"));
    for (const nome of iniciais) {
      expect(sql.slice(0, sql.indexOf("create or replace function app.bootstrap_house"))).toContain(`'${nome}'`);
      expect(casaNova).toContain(`'${nome}'`);
    }
    // Subcategoria herda o lado da mae.
    expect(sql).toMatch(/select kind into new\.kind from public\.categories where id = new\.parent_id/);
  });
});
