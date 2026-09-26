import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * O cartao de proposta na conversa.
 *
 * O que guarda: nada e gravado sem o toque em Confirmar; "aprender" pode ser
 * desmarcado; descartar nao chama o servidor; e na pergunta seguinte o
 * modelo fica sabendo o que a casa fez com a proposta.
 */

const aplicadas: unknown[] = [];
const perguntas: { messages: { role: string; content: string }[] }[] = [];
let respostas: Record<string, unknown>[] = [];

const PROPOSTA = {
  kind: "classificar",
  id: "p1",
  transactionIds: ["abcd1111-0000-4000-8000-000000000001", "abcd2222-0000-4000-8000-000000000002"],
  categoryId: "aaaaaaaa-0000-4000-8000-000000000002",
  subcategoryId: null,
  learnMerchant: "UBERRIDES",
  summary: {
    categoryLabel: "Transporte",
    count: 2,
    totalCents: 5450,
    examples: [{ date: "2026-09-10", label: "UBERRIDES", cents: 2350 }],
  },
};

vi.mock("@/actions/chat", () => ({
  askHouse: async (input: { messages: { role: string; content: string }[] }) => {
    perguntas.push(input);
    return respostas.shift() ?? { answer: "ok" };
  },
  applyProposal: async (p: unknown) => {
    aplicadas.push(p);
    return { ok: true, count: 2 };
  },
}));

const { ChatPanel } = await import("@/components/chat/chat-panel");

async function comProposta() {
  respostas = [{ answer: "Proponho classificar os 2 UBERRIDES como Transporte.", proposals: [PROPOSTA], tier: "pago" }];
  render(<ChatPanel houseId="casa-1" />);
  fireEvent.change(screen.getByLabelText("Pergunta"), { target: { value: "classifica o uber" } });
  fireEvent.keyDown(screen.getByLabelText("Pergunta"), { key: "Enter" });
  await screen.findByText(/Classificar 2 lançamento\(s\) em Transporte/);
}

describe("cartão de proposta", () => {
  beforeEach(() => {
    aplicadas.length = 0;
    perguntas.length = 0;
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("mostra o que vai mudar, e nada é gravado antes do toque", async () => {
    await comProposta();
    expect(screen.getByText(/Total R\$\s?54,50/)).toBeTruthy();
    expect(aplicadas).toHaveLength(0);
  });

  it("confirmar grava, com 'aprender' — e o modelo fica sabendo na próxima pergunta", async () => {
    await comProposta();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    await screen.findByText("Feito.");
    expect(aplicadas[0]).toMatchObject({ kind: "classificar", learn: true, learnMerchant: "UBERRIDES" });

    fireEvent.change(screen.getByLabelText("Pergunta"), { target: { value: "e agora?" } });
    fireEvent.keyDown(screen.getByLabelText("Pergunta"), { key: "Enter" });
    await waitFor(() => expect(perguntas).toHaveLength(2));
    const resposta = perguntas[1]!.messages[1]!;
    expect(resposta.role).toBe("assistant");
    expect(resposta.content).toMatch(/\[2 lançamento\(s\) classificados em Transporte\.\]/);
  });

  it("desmarcar 'as próximas faturas' não cria regra", async () => {
    await comProposta();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    await screen.findByText("Feito.");
    expect(aplicadas[0]).toMatchObject({ learn: false });
  });

  it("descartar não chama o servidor, e fica registrado", async () => {
    await comProposta();
    fireEvent.click(screen.getByRole("button", { name: /Descartar/ }));
    await screen.findByText("Descartada.");
    expect(aplicadas).toHaveLength(0);
  });
});
