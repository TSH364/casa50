import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { rotuloDoCartao, temNomeAutomatico } from "@/domain/cartoes";

/**
 * Nome dos cartoes - pedido da casa: "so pelo numero nao da para saber qual
 * e qual".
 *
 * O que guarda: o app reconhece o nome automatico da importacao ("Cartão
 * 2150") e pede um nome ali mesmo; com nome dado, o cartao aparece por ele
 * (e o final so desempata); e o campo salva so o nome, deste cartao.
 */

const renameCard = vi.fn(async (_input: { cardId: string; name: string }) => ({ ok: true }) as { ok?: boolean; error?: string });
vi.mock("@/actions/cards", () => ({ renameCard: (input: { cardId: string; name: string }) => renameCard(input) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("nome automático", () => {
  it("reconhece o nome que a importação deu", () => {
    expect(temNomeAutomatico({ name: "Cartão 2150", lastFour: "2150" })).toBe(true);
    expect(temNomeAutomatico({ name: "cartao  2150", lastFour: "2150" })).toBe(true);
    expect(temNomeAutomatico({ name: "Cartão ···· 2150", lastFour: "2150" })).toBe(true);
    expect(temNomeAutomatico({ name: "Cartão", lastFour: null })).toBe(true);
  });

  it("nome dado pela casa não é automático", () => {
    expect(temNomeAutomatico({ name: "Nubank da Lari", lastFour: "2150" })).toBe(false);
    expect(temNomeAutomatico({ name: "Cartão do Itaú", lastFour: "2150" })).toBe(false);
    // Outro final: a casa escreveu de propósito.
    expect(temNomeAutomatico({ name: "Cartão 9999", lastFour: "2150" })).toBe(false);
  });

  it("rótulo: o nome da casa com o final; sem nome, só o final", () => {
    expect(rotuloDoCartao({ name: "Nubank da Lari", lastFour: "2150" })).toBe("Nubank da Lari ···· 2150");
    expect(rotuloDoCartao({ name: "Cartão 2150", lastFour: "2150" })).toBe("Cartão ···· 2150");
    expect(rotuloDoCartao({ name: "C6", lastFour: null })).toBe("C6");
  });
});

describe("Que cartão é esse?", () => {
  it("salva só o nome deste cartão e avisa quem pediu", async () => {
    const { NomearCartao } = await import("@/components/cards/nomear-cartao");
    const onNomeado = vi.fn();
    render(<NomearCartao cardId="cartao-1" lastFour="2150" onNomeado={onNomeado} />);

    const campo = screen.getByLabelText(/Nome do cartão final 2150/);
    const salvar = screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    // Uma letra so nao e nome.
    fireEvent.change(campo, { target: { value: "N" } });
    expect(salvar.disabled).toBe(true);

    fireEvent.change(campo, { target: { value: "  Nubank da Lari " } });
    await act(async () => {
      fireEvent.click(salvar);
    });
    expect(renameCard).toHaveBeenCalledWith({ cardId: "cartao-1", name: "Nubank da Lari" });
    expect(onNomeado).toHaveBeenCalledWith("Nubank da Lari");
  });
});
