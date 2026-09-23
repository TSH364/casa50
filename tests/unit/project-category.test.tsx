import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Category } from "@/domain/types";

/**
 * A categoria das despesas que o projeto lança.
 *
 * O que guarda: que dá para voltar a "sem categoria", que subcategoria fica
 * fora da lista, e que uma categoria fora dos totais aparece MARCADA - escolher
 * uma sem saber faria as despesas da obra sumirem do total do mês, o contrário
 * do que lançá-las pretendia.
 */

const enviados: unknown[] = [];

vi.mock("@/actions/project", () => ({
  setProjectCategory: async (input: unknown) => {
    enviados.push(input);
    return { ok: true };
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ProjectCategory } = await import("@/components/project/project-category");

function categoria(partial: Partial<Category>): Category {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    houseId: "h",
    name: "X",
    color: "#000",
    icon: null,
    parentId: null,
    isActive: true,
    excludedFromTotals: false,
    ...partial,
  };
}

const MORADIA = categoria({ id: "11111111-1111-1111-1111-111111111111", name: "Moradia" });
const REFORMA = categoria({
  id: "22222222-2222-2222-2222-222222222222",
  name: "Reforma",
  excludedFromTotals: true,
});
const SUB = categoria({
  id: "33333333-3333-3333-3333-333333333333",
  name: "Aluguel",
  parentId: MORADIA.id,
});

const PROJETO = "44444444-4444-4444-4444-444444444444";

describe("ProjectCategory", () => {
  beforeEach(() => {
    enviados.length = 0;
  });

  it("lista só as de primeiro nível, e marca a que está fora dos totais", () => {
    render(<ProjectCategory projectId={PROJETO} categoryId={null} categories={[MORADIA, REFORMA, SUB]} />);
    const rotulos = [...screen.getByRole("combobox").querySelectorAll("option")].map((o) => o.textContent);
    expect(rotulos).toEqual(["Sem categoria", "Moradia", "Reforma (fora dos totais)"]);
  });

  it("grava a escolha", async () => {
    render(<ProjectCategory projectId={PROJETO} categoryId={null} categories={[MORADIA]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: MORADIA.id } });
    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0]).toEqual({ projectId: PROJETO, categoryId: MORADIA.id });
  });

  it("volta para sem categoria mandando null, e não texto vazio", async () => {
    // Texto vazio nao e uuid, e o servidor recusaria - a pessoa ficaria presa
    // na categoria escolhida.
    render(<ProjectCategory projectId={PROJETO} categoryId={MORADIA.id} categories={[MORADIA]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0]).toEqual({ projectId: PROJETO, categoryId: null });
  });
});
