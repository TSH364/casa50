import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * O limite de gasto na lista de Categorias: definir ali mesmo, sem ir a
 * Orcamentos; o valor vai em centavos para o mes; vazio tira o limite.
 */

const setBudget = vi.fn(async (_input: unknown) => ({ ok: true }) as { ok?: boolean; error?: string });
vi.mock("@/actions/budgets", () => ({ setBudget: (i: unknown) => setBudget(i) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { LimiteDaCategoria } = await import("@/components/categories/limite-da-categoria");
const MER = "00000000-0000-4000-8000-000000000001";

describe("o limite na lista de Categorias", () => {
  it("sem limite: “Definir limite de gasto”; salvar manda o valor em centavos para o mês", async () => {
    render(<LimiteDaCategoria categoryId={MER} nome="Mercado" limiteCents={0} mes="2026-11" />);
    fireEvent.click(screen.getByRole("button", { name: "Definir um limite de gasto para Mercado" }));
    expect(screen.getByText(/Vale de novembro de 2026 em diante/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Limite por mês (R$)"), { target: { value: "1.250,50" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    expect(setBudget).toHaveBeenLastCalledWith({ categoryId: MER, month: "2026-11", limitCents: 125_050 });
  });

  it("com limite: mostra o valor; esvaziar e salvar tira o limite", async () => {
    render(<LimiteDaCategoria categoryId={MER} nome="Mercado" limiteCents={180_000} mes="2026-11" />);
    fireEvent.click(screen.getByRole("button", { name: /Limite de Mercado: R\$\s1\.800,00 por mês/ }));
    const campo = screen.getByLabelText("Limite por mês (R$)") as HTMLInputElement;
    expect(campo.value).toBe("1800");
    fireEvent.change(campo, { target: { value: "" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    expect(setBudget).toHaveBeenLastCalledWith({ categoryId: MER, month: "2026-11", limitCents: 0 });
  });

  it("valor que não é dinheiro: avisa e não salva", async () => {
    setBudget.mockClear();
    render(<LimiteDaCategoria categoryId={MER} nome="Lazer" limiteCents={0} mes="2026-11" />);
    fireEvent.click(screen.getByRole("button", { name: "Definir um limite de gasto para Lazer" }));
    fireEvent.change(screen.getByLabelText("Limite por mês (R$)"), { target: { value: "muito" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    expect(screen.getByText(/Use um valor em reais/)).toBeTruthy();
    expect(setBudget).not.toHaveBeenCalled();
  });
});
