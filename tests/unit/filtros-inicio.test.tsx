import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Os filtros do Inicio num botao so: a pilula diz o recorte em uso, o toque
 * abre a folha com os controles, e escolher um filtro (a URL muda) fecha.
 */

let busca = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(busca) }));

describe("filtros do Início", () => {
  it("resume o recorte, abre a folha e fecha ao escolher", async () => {
    const { FiltrosInicio } = await import("@/components/home/filtros-inicio");
    const { rerender } = render(
      <FiltrosInicio resumo="Todos · sem TSH" ativo={false}>
        <a href="?membro=1">Vini</a>
      </FiltrosInicio>,
    );
    const botao = screen.getByRole("button", { name: "Filtros: Todos · sem TSH. Tocar para mudar." });
    expect(botao.textContent).toBe("Todos · sem TSH");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(botao);
    expect(screen.getByRole("dialog").textContent).toContain("Vini");

    busca = "membro=1";
    await act(async () => {
      rerender(
        <FiltrosInicio resumo="Vini · sem TSH" ativo>
          <a href="?membro=1">Vini</a>
        </FiltrosInicio>,
      );
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Filtros: Vini · sem TSH/ })).toBeTruthy();
  });
});
