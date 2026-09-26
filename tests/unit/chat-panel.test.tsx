import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * A tela da conversa.
 *
 * O que guarda: o aviso do gratuito aparece antes da primeira pergunta; a
 * pergunta vai com o historico, sem as bolhas de erro; a conversa sobrevive a
 * recarga NESTE aparelho; e "Limpar" apaga de verdade.
 */

const enviados: { messages: { role: string; content: string }[] }[] = [];
let resposta: Record<string, unknown> = { answer: "Gastaram **R$ 320,00**.", consulted: ["resumo do mês"], model: "x:free" };

vi.mock("@/actions/chat", () => ({
  askHouse: async (input: { messages: { role: string; content: string }[] }) => {
    enviados.push(input);
    return resposta;
  },
}));

const { ChatPanel } = await import("@/components/chat/chat-panel");

describe("ChatPanel", () => {
  beforeEach(() => {
    enviados.length = 0;
    window.localStorage.clear();
    resposta = { answer: "Gastaram **R$ 320,00**.", consulted: ["resumo do mês"], model: "x:free" };
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("avisa, antes da primeira pergunta, o que vai para o gratuito e o que vai para o pago", () => {
    render(<ChatPanel houseId="casa-1" />);
    expect(screen.getByText(/pode guardar e usar\s+o que recebe/)).toBeTruthy();
    expect(screen.getByText(/modelo pago que não guarda/)).toBeTruthy();
  });

  it("pergunta, mostra a resposta com o que consultou, e guarda no aparelho", async () => {
    const { unmount } = render(<ChatPanel houseId="casa-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Quanto gastamos este mês?" }));
    await screen.findByText("R$ 320,00");
    expect(screen.getByText(/Consultei: resumo do mês · x:free/)).toBeTruthy();
    expect(enviados[0]?.messages).toEqual([{ role: "user", content: "Quanto gastamos este mês?" }]);
    unmount();

    // Recarga: a conversa volta.
    render(<ChatPanel houseId="casa-1" />);
    expect(await screen.findByText("R$ 320,00")).toBeTruthy();
  });

  it("erro aparece na tela, mas não volta para o modelo", async () => {
    resposta = { error: "Acabou a cota dos modelos gratuitos por agora." };
    render(<ChatPanel houseId="casa-1" />);
    const campo = screen.getByLabelText("Pergunta");
    fireEvent.change(campo, { target: { value: "oi" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByText(/Acabou a cota/);

    resposta = { answer: "Agora sim." };
    fireEvent.change(campo, { target: { value: "e agora?" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByText("Agora sim.");
    expect(enviados[1]?.messages.map((m) => m.content)).toEqual(["oi", "e agora?"]);
  });

  it("limpar apaga da tela e do aparelho", async () => {
    render(<ChatPanel houseId="casa-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Quanto gastamos este mês?" }));
    await screen.findByText("R$ 320,00");
    fireEvent.click(screen.getByRole("button", { name: /Limpar conversa/ }));
    await waitFor(() => expect(screen.queryByText("R$ 320,00")).toBeNull());
    expect(window.localStorage.getItem("fluxo-conversa:casa-1")).toBeNull();
  });
});
