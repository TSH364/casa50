import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { speakable } from "@/lib/voice";

/**
 * Voz na Conversa: o microfone so aparece com suporte do navegador; o texto
 * parcial aparece enquanto se fala; ao parar, a frase vai como pergunta; e a
 * resposta de uma pergunta falada e lida em voz alta.
 */

const perguntas: { messages: { role: string; content: string }[] }[] = [];
vi.mock("@/actions/chat", () => ({
  chatGreeting: async () => null,
  askHouse: async (input: { messages: { role: string; content: string }[] }) => {
    perguntas.push(input);
    return { answer: "Vocês gastaram **R$ 1.234,56** com #abcd1234 Mercado.", tier: "pago" };
  },
  applyProposal: async () => ({ ok: true }),
}));

class ReconhecedorFalso {
  static ultimo: ReconhecedorFalso | null = null;
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    ReconhecedorFalso.ultimo = this;
  }
  stop() {
    this.onend?.();
  }
  abort() {}
  fala(texto: string, final: boolean) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: texto } }] });
  }
}

const falado: string[] = [];

describe("voz", () => {
  beforeEach(() => {
    perguntas.length = 0;
    falado.length = 0;
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = ReconhecedorFalso;
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: () => {},
      getVoices: () => [],
      speak: (u: { text: string }) => falado.push(u.text),
    };
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      lang = "";
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(t: string) {
        this.text = t;
      }
    };
    localStorage.clear();
    Element.prototype.scrollIntoView = () => {};
  });

  it("falar: mostra o parcial, envia ao terminar, e lê a resposta", async () => {
    const { ChatPanel } = await import("@/components/chat/chat-panel");
    render(<ChatPanel houseId="casa-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Falar o pedido" }));
    expect(ReconhecedorFalso.ultimo!.lang).toBe("pt-BR");

    act(() => ReconhecedorFalso.ultimo!.fala("quanto gastamos", false));
    expect((screen.getByLabelText("Pergunta") as HTMLTextAreaElement).value).toBe("quanto gastamos");
    expect(screen.getByText(/transcrita pelo navegador/)).toBeTruthy();

    act(() => {
      ReconhecedorFalso.ultimo!.fala("quanto gastamos com mercado", true);
      ReconhecedorFalso.ultimo!.onend!();
    });
    await waitFor(() => expect(perguntas).toHaveLength(1));
    expect(perguntas[0]!.messages.at(-1)).toEqual({ role: "user", content: "quanto gastamos com mercado" });
    await waitFor(() => expect(falado).toHaveLength(1));
    expect(falado[0]).toBe("Vocês gastaram 1.234,56 com Mercado.");
  });

  it("microfone negado vira frase, sem enviar nada", async () => {
    const { ChatPanel } = await import("@/components/chat/chat-panel");
    render(<ChatPanel houseId="casa-2" />);
    fireEvent.click(await screen.findByRole("button", { name: "Falar o pedido" }));
    act(() => {
      ReconhecedorFalso.ultimo!.onerror!({ error: "not-allowed" });
      ReconhecedorFalso.ultimo!.onend!();
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(/microfone está bloqueado/);
    expect(perguntas).toHaveLength(0);
  });

  it("texto para ouvir: sem markdown, código e endereço", () => {
    expect(speakable("**Total:** R$ 50,00 em #abcd1234 https://x.com/a")).toBe("Total: 50,00 em");
  });
});
