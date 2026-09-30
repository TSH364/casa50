import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * A Dor.IA no meio da barra.
 *
 * O que guarda: a barra do celular tem cinco lugares, com a Dor.IA no meio;
 * o botao abre a conversa do jeito usado por ultimo (voz na primeira vez) e
 * segurar abre por texto; tema e Sair ficam no "Mais"; e a conversa aberta
 * pela voz explica antes do microfone na primeira vez, e na seguinte ja
 * entra ouvindo.
 */

const push = vi.fn();
let caminho = "/inicio";
vi.mock("next/navigation", () => ({
  usePathname: () => caminho,
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("@/app/entrar/actions", () => ({ signOut: vi.fn() }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

beforeEach(() => {
  push.mockClear();
  caminho = "/inicio";
  localStorage.clear();
});

describe("barra de baixo", () => {
  it("cinco lugares, a Dor.IA no meio; tema e Sair no Mais", async () => {
    const { AppNav } = await import("@/components/app-nav");
    render(<AppNav tema="claro" versao="v0.2" versaoCompleta="v0.2 · abc" />);
    const barra = screen.getAllByRole("navigation", { name: "Navegação principal" })[0]!;
    const itens = [...barra.querySelectorAll("li")].map((li) => li.textContent?.trim());
    expect(itens).toEqual(["Início", "Extratos", "Dor.IA", "Análise", "Mais"]);

    fireEvent.click(screen.getByRole("button", { name: "Mais" }));
    const folha = await screen.findByRole("dialog");
    for (const nome of ["Metas", "Projetos", "Tarefas", "Casa"]) {
      expect(folha.textContent).toContain(nome);
    }
    expect(screen.getByRole("button", { name: /Sair/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tema claro/ })).toBeTruthy();
  });

  it("toque abre do último jeito (voz na primeira vez); segurar abre por texto", async () => {
    vi.useFakeTimers();
    try {
      const { AppNav } = await import("@/components/app-nav");
      render(<AppNav tema="claro" versao="v0.2" versaoCompleta="v0.2" />);
      const botao = screen.getByRole("button", { name: /Falar com a Dor\.IA/ });

      fireEvent.pointerDown(botao);
      fireEvent.pointerUp(botao);
      fireEvent.click(botao);
      expect(push).toHaveBeenLastCalledWith("/conversa?modo=voz");

      fireEvent.pointerDown(botao);
      act(() => vi.advanceTimersByTime(500));
      fireEvent.pointerUp(botao);
      fireEvent.click(botao);
      expect(push).toHaveBeenLastCalledWith("/conversa?modo=texto");
      expect(push).toHaveBeenCalledTimes(2);

      // O ultimo jeito ficou lembrado.
      fireEvent.pointerDown(botao);
      fireEvent.pointerUp(botao);
      fireEvent.click(botao);
      expect(push).toHaveBeenLastCalledWith("/conversa?modo=texto");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------

vi.mock("@/actions/chat", () => ({
  chatGreeting: async () => null,
  askHouse: async () => ({ answer: "ok" }),
  applyProposal: async () => ({ ok: true }),
}));

class Rec {
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start() {}
  stop() {}
  abort() {}
}

describe("conversa aberta pela voz", () => {
  beforeEach(() => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Rec;
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: () => {},
      getVoices: () => [],
      speak: () => {},
    };
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      constructor(public text: string) {}
    };
    Element.prototype.scrollIntoView = () => {};
  });

  it("primeira vez: explica antes do microfone; permitir entra na voz e fica lembrado", async () => {
    const { ChatPanel } = await import("@/components/chat/chat-panel");
    const { unmount } = render(<ChatPanel houseId="casa-1" modo="voz" />);
    expect(await screen.findByRole("heading", { name: "Posso ouvir você?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Permitir o microfone/ }));
    expect(await screen.findByRole("dialog", { name: "Conversa por voz" })).toBeTruthy();
    unmount();

    // Na seguinte, ja entra na voz, sem a explicacao.
    render(<ChatPanel houseId="casa-1" modo="voz" />);
    expect(await screen.findByRole("dialog", { name: "Conversa por voz" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Posso ouvir você?" })).toBeNull();
  });

  it("prefiro escrever: fecha a voz, foca o campo e lembra o texto", async () => {
    localStorage.setItem("fluxo-doria-voz-ok", "1");
    const { ChatPanel } = await import("@/components/chat/chat-panel");
    render(<ChatPanel houseId="casa-2" modo="voz" />);
    fireEvent.click(await screen.findByRole("button", { name: /Prefiro escrever/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Pergunta")));
    expect(screen.queryByRole("dialog", { name: "Conversa por voz" })).toBeNull();
    expect(localStorage.getItem("fluxo-doria-modo")).toBe("texto");
  });
});
