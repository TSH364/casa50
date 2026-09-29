import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * O cartao "Leitura da IA".
 *
 * O que guarda: nada roda ao abrir (so no toque); a analise nova aparece com
 * a evidencia dos fatos; erro aparece como alerta; sem chave, o cartao manda
 * para a Casa em vez de mostrar um botao que falharia.
 */

const pedidos: unknown[] = [];
let resposta: Record<string, unknown> = {};

vi.mock("@/actions/ai-insights", () => ({
  analyzeMonth: async (input: unknown) => {
    pedidos.push(input);
    return resposta;
  },
}));

const { AiAnalysisCard } = await import("@/components/insights/ai-analysis");

const ANALISE = {
  items: [
    {
      title: "Delivery triplicou",
      text: "R$ 600,00 contra R$ 200,00 de média.",
      tone: "attention" as const,
      suggestion: "Combinar um dia sem delivery.",
      evidence: [{ label: "Categoria Delivery no mês", value: "R$ 600,00; média anterior R$ 200,00" }],
    },
  ],
  dropped: 1,
  model: "google/gemini-3.6-flash",
  createdAt: "2026-09-26T17:03:00Z",
};

describe("AiAnalysisCard", () => {
  it("só chama a IA no toque, e mostra a análise com a evidência", async () => {
    resposta = { analysis: ANALISE };
    render(<AiAnalysisCard month="2026-09" scope="casa" initial={null} enabled />);
    expect(pedidos).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Analisar o mês com IA/ }));
    expect(await screen.findByText("Delivery triplicou")).toBeTruthy();
    expect(pedidos).toEqual([{ month: "2026-09", scope: "casa" }]);
    expect(screen.getByText("Categoria Delivery no mês:")).toBeTruthy();
    expect(screen.getByText(/1 análise foi descartada/)).toBeTruthy();
    expect(screen.getByText(/Feita em 26\/09 às 14:03/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Refazer análise/ })).toBeTruthy();
  });

  it("erro vira alerta", async () => {
    resposta = { error: "A análise demorou demais. Tente de novo." };
    render(<AiAnalysisCard month="2026-09" scope="tudo" initial={null} enabled />);
    fireEvent.click(screen.getByRole("button", { name: /Analisar o mês com IA/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/demorou demais/);
  });

  it("sem chave: aponta para a Casa, sem botão", () => {
    render(<AiAnalysisCard month="2026-09" scope="casa" initial={null} enabled={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Casa" }).getAttribute("href")).toBe("/casa");
  });
});
