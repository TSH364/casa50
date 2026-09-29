import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildGreeting } from "@/domain/greeting";
import { voiceIntent } from "@/domain/voice-intent";
import { buildSystemPrompt } from "@/domain/chat";
import type { Proposal } from "@/domain/chat";

/**
 * A Conversa mais conversacional.
 *
 * O que guarda: o resumo do dia so fala do que pede atencao, com sugestoes
 * que saem disso; confirmar por voz e ESTRITO (so a frase inteira); a
 * resposta falada tem regras proprias no prompt; e o modo conversa fecha o
 * laco - ouve, pergunta, fala, ouve de novo; "pode" confirma as propostas
 * pendentes pelo mesmo caminho do cartao; "tchau" encerra; silencio pausa.
 */

describe("resumo do dia", () => {
  const base = {
    firstName: "Vinicius",
    hour: 9,
    yesterday: { cents: 8_450, count: 3 },
    month: { label: "setembro", spentCents: 812_000, projectionCents: 1_050_000, averageCents: 800_000 },
    budgets: [
      { name: "Mercado", ratio: 0.92 },
      { name: "Lazer", ratio: 0.3 },
    ],
    tasks: [{ title: "Trocar o chuveiro", daysLeft: 1 }],
    uncategorized: 12,
  };

  it("saudação, ontem, e só o que pede atenção (no máximo três), com sugestões disso", () => {
    const g = buildGreeting(base);
    expect(g.text).toMatch(/^Bom dia, Vinicius! Ontem saíram R\$\s*84,50 em 3 compras, e setembro está em R\$\s*8\.120,00\./);
    expect(g.text).toMatch(/Mercado já usou 92% do orçamento/);
    expect(g.text).toMatch(/fecha em R\$\s*10\.500,00, acima da média/);
    expect(g.text).toMatch(/"Trocar o chuveiro" vence amanhã/);
    // Quarto destaque (sem categoria) fica de fora: tres no maximo.
    expect(g.text).not.toMatch(/sem categoria/);
    expect(g.text).not.toMatch(/Lazer/);
    expect(g.suggestions[0]).toBe("Por que Mercado está tão alto?");
    expect(g.suggestions.length).toBeLessThanOrEqual(4);
  });

  it("dia tranquilo: diz que não há nada pedindo atenção", () => {
    const g = buildGreeting({ ...base, hour: 20, yesterday: { cents: 0, count: 0 }, budgets: [], tasks: [], uncategorized: 0, month: { ...base.month, projectionCents: 810_000 } });
    expect(g.text).toMatch(/^Boa noite, Vinicius! Setembro está em/);
    expect(g.text).toMatch(/Nada pedindo atenção agora/);
  });
});

describe("intenção falada", () => {
  it("confirmar só com a frase inteira, e só havendo proposta", () => {
    expect(voiceIntent("Pode.", true)).toBe("confirmar");
    expect(voiceIntent("sim, pode confirmar", true)).toBe("confirmar");
    expect(voiceIntent("pode me dizer quanto gastei?", true)).toBe("pergunta");
    expect(voiceIntent("sim, mas muda o valor para 200", true)).toBe("pergunta");
    expect(voiceIntent("pode", false)).toBe("pergunta");
    expect(voiceIntent("Não, deixa pra lá", true)).toBe("pergunta");
    expect(voiceIntent("deixa pra lá", true)).toBe("descartar");
    expect(voiceIntent("Tchau!", false)).toBe("encerrar");
  });
});

describe("prompt", () => {
  const ctx = {
    houseName: "Casa 50", today: "29/09/2026", currentMonth: "2026-09", members: ["Vinicius"],
    categories: [], excludedCategories: [], monthsWithData: [], snapshot: null,
  };
  it("jeito de conversar sempre; regras de fala só no modo voz", () => {
    expect(buildSystemPrompt(ctx)).toMatch(/JEITO DE CONVERSAR/);
    expect(buildSystemPrompt(ctx)).not.toMatch(/VAI SER FALADA/);
    expect(buildSystemPrompt({ ...ctx, mode: "voz" })).toMatch(/VAI SER FALADA.*no máximo 3 frases/);
  });
});

// ---------------------------------------------------------------------------

const aplicadas: unknown[] = [];
vi.mock("@/actions/chat", () => ({
  chatGreeting: async () => null,
  askHouse: async () => ({}),
  applyProposal: async (p: unknown) => {
    aplicadas.push(p);
    return { ok: true, count: 1 };
  },
}));

class Rec {
  static atual: Rec | null = null;
  static inicios = 0;
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    Rec.atual = this;
    Rec.inicios += 1;
  }
  stop() {
    this.onend?.();
  }
  abort() {}
  diz(t: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: t } }] });
    this.onend?.();
  }
  silencio() {
    this.onerror?.({ error: "no-speech" });
    this.onend?.();
  }
}

const falas: string[] = [];

describe("modo conversa por voz", () => {
  beforeEach(() => {
    aplicadas.length = 0;
    falas.length = 0;
    Rec.atual = null;
    Rec.inicios = 0;
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Rec;
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: () => {},
      getVoices: () => [],
      // A fala "termina" logo depois de comecar.
      speak: (u: { text: string; onend: () => void }) => {
        falas.push(u.text);
        setTimeout(() => u.onend(), 0);
      },
    };
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      lang = "";
      voice = null;
      onend: () => void = () => {};
      onerror: () => void = () => {};
      constructor(t: string) {
        this.text = t;
      }
    };
  });

  const META: Proposal = {
    kind: "meta",
    id: "m1",
    fields: { name: "Viagem", targetCents: 500_000, targetDate: null, monthlyCents: null, ownerId: null },
    summary: { ownerLabel: null },
  };

  it("fala o resumo, ouve, pergunta, responde falando e volta a ouvir; 'pode' confirma; 'tchau' encerra", async () => {
    const { VoiceMode } = await import("@/components/chat/voice-mode");
    let pendentes: Proposal[] = [];
    const resolvidas: [string, string][] = [];
    const perguntas: string[] = [];
    const fechar = vi.fn();
    render(
      <VoiceMode
        greeting="Bom dia! Setembro está em R$ 8.120,00."
        ask={async (t) => {
          perguntas.push(t);
          pendentes = [META];
          return "Propus a meta Viagem de R$ 5.000,00. Posso confirmar?";
        }}
        pending={() => (pendentes.length ? { index: 3, proposals: pendentes } : null)}
        resolve={(_i, id, status) => {
          resolvidas.push([id, status]);
          pendentes = [];
        }}
        onClose={fechar}
      />,
    );

    await waitFor(() => expect(Rec.inicios).toBe(1));
    expect(falas[0]).toBe("Bom dia! Setembro está em 8.120,00.");

    await act(async () => Rec.atual!.diz("cria uma meta de cinco mil pra viagem"));
    await waitFor(() => expect(Rec.inicios).toBe(2));
    expect(perguntas).toEqual(["cria uma meta de cinco mil pra viagem"]);
    expect(falas[1]).toMatch(/Posso confirmar\?/);
    expect(screen.getByText("Nova meta: Viagem")).toBeTruthy();

    await act(async () => Rec.atual!.diz("pode"));
    await waitFor(() => expect(Rec.inicios).toBe(3));
    expect(aplicadas).toEqual([{ kind: "meta", fields: META.fields }]);
    expect(resolvidas).toEqual([["m1", "feito"]]);
    expect(falas[2]).toMatch(/^Pronto\. Meta criada: Viagem\./);

    await act(async () => Rec.atual!.diz("tchau"));
    await waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(falas.at(-1)).toBe("Até mais!");
  });

  it("dois silêncios seguidos pausam; tocar no círculo volta a ouvir", async () => {
    const { VoiceMode } = await import("@/components/chat/voice-mode");
    render(<VoiceMode greeting={null} ask={async () => "ok"} pending={() => null} resolve={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(Rec.inicios).toBe(1));
    act(() => Rec.atual!.silencio());
    expect(Rec.inicios).toBe(2);
    act(() => Rec.atual!.silencio());
    expect(await screen.findByText("Em pausa")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar a conversa" }));
    expect(Rec.inicios).toBe(3);
  });
});
