import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * O gasto de IA: anotado por uso, somado por mes, mostrado na Casa.
 *
 * O que guarda: o custo sai da resposta do OpenRouter (`usage.cost`) e chega
 * a quem chamou; o registro arredonda em seis casas e nunca derruba quem
 * chamou; o mes e somado por uso, no fuso da casa; e a tela mostra centavos
 * de centavo sem arredondar para zero.
 */

vi.mock("server-only", () => ({}));

const db = {
  inseridos: [] as Record<string, unknown>[],
  linhas: [] as { feature: string; calls: number; cost_usd: string }[],
  filtros: [] as unknown[],
  falhar: false,
  usuario: { id: "u1" } as { id: string } | null,
};

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => db.usuario,
  createClient: async () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "limit"]) b[m] = () => b;
      for (const m of ["eq", "gte"]) b[m] = (...a: unknown[]) => { db.filtros.push([m, ...a]); return b; };
      b.insert = async (row: Record<string, unknown>) => {
        if (db.falhar) throw new Error("rede");
        db.inseridos.push(row);
        return { error: null };
      };
      b.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: db.linhas, error: null }).then(ok);
      return b;
    },
  }),
}));

describe("OpenRouter devolve o custo", () => {
  it("chatTurn traz o custo; decide e chatCompletion avisam quem chamou", async () => {
    const { chatTurn, decide, chatCompletion } = await import("@/lib/openrouter");
    const resp = (corpo: unknown) => (async () => new Response(JSON.stringify(corpo), { status: 200 })) as unknown as typeof fetch;

    const t = await chatTurn([{ role: "user", content: "oi" }], {
      apiKey: "k", model: "m", tools: [], allowDataCollection: false,
      fetchImpl: resp({ model: "g", choices: [{ message: { content: "ok" } }], usage: { cost: 0.0031 } }),
    });
    expect(t.costUsd).toBe(0.0031);

    const avisos: unknown[] = [];
    await decide("s", { q: { type: "choice", instructions: "i", criteria: { a: "a" } } }, {
      apiKey: "k", model: "typesafe/jev-1.13", onUsage: (u) => avisos.push(u),
      fetchImpl: resp({ answers: { q: { choice: "a", probabilities: { a: 1 } } }, usage: { cost: 0.000018 } }),
    });
    await chatCompletion([{ role: "user", content: "oi" }], {
      apiKey: "k", onUsage: (u) => avisos.push(u),
      fetchImpl: resp({ model: "anthropic/x", choices: [{ message: { content: "{}" } }], usage: { cost: 0.012 } }),
    });
    expect(avisos).toEqual([
      { costUsd: 0.000018, model: "typesafe/jev-1.13" },
      { costUsd: 0.012, model: "anthropic/x" },
    ]);
  });

  it("custo ausente ou estranho vira zero, sem derrubar a chamada", async () => {
    const { chatTurn } = await import("@/lib/openrouter");
    const t = await chatTurn([{ role: "user", content: "oi" }], {
      apiKey: "k", model: "m", tools: [], allowDataCollection: true,
      fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { cost: "abc" } }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(t.costUsd).toBe(0);
  });
});

describe("recordAiUsage", () => {
  beforeEach(() => {
    db.inseridos = [];
    db.falhar = false;
    db.usuario = { id: "u1" };
  });

  it("anota em nome de quem usou, em seis casas", async () => {
    const { recordAiUsage } = await import("@/lib/ai-usage");
    await recordAiUsage("casa-1", "jev", { calls: 3, costUsd: 0.0000541234, model: "typesafe/jev-1.13" });
    expect(db.inseridos[0]).toEqual({
      house_id: "casa-1", feature: "jev", model: "typesafe/jev-1.13", calls: 3, cost_usd: 0.000054, created_by: "u1",
    });
  });

  it("sem chamada, não anota; falha ao anotar não derruba quem chamou", async () => {
    const { recordAiUsage } = await import("@/lib/ai-usage");
    await recordAiUsage("casa-1", "jev", { calls: 0, costUsd: 0 });
    expect(db.inseridos).toEqual([]);
    db.falhar = true;
    await expect(recordAiUsage("casa-1", "orcamento", { calls: 1, costUsd: 0.01 })).resolves.toBeUndefined();
  });
});

describe("aiKeyUsage", () => {
  beforeEach(() => {
    vi.doMock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
    vi.doMock("@/lib/ai-config", () => ({ getAiKey: async () => "sk-or-x" }));
    vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { usage: 2, limit: 10, usage_daily: 0.1, usage_weekly: 0.5, usage_monthly: 1.2 } }), { status: 200 })),
    );
    db.filtros = [];
    db.linhas = [
      { feature: "jev", calls: 40, cost_usd: "0.000800" },
      { feature: "conversa_paga", calls: 3, cost_usd: "0.004100" },
      { feature: "conversa_paga", calls: 2, cost_usd: "0.002000" },
      { feature: "conversa_gratuita", calls: 5, cost_usd: "0" },
    ];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("soma o mês por uso, na ordem da tela, a partir do dia 1 no fuso da casa", async () => {
    vi.resetModules();
    const { aiKeyUsage } = await import("@/actions/ai-settings");
    const r = await aiKeyUsage();
    expect(r.info).toMatchObject({ usageUsd: 2, dailyUsd: 0.1, monthlyUsd: 1.2 });
    expect(r.month!.byFeature.map((u) => [u.feature, u.calls])).toEqual([
      ["conversa_paga", 5],
      ["conversa_gratuita", 5],
      ["jev", 40],
    ]);
    expect(r.month!.totalUsd).toBeCloseTo(0.0069, 6);
    const desde = db.filtros.find((f) => (f as unknown[])[0] === "gte") as unknown[];
    expect(String(desde[2])).toMatch(/^\d{4}-\d{2}-01T00:00:00-03:00$/);
  });
});

describe("tela", () => {
  it("mostra hoje/semana/mês, e o mês por uso sem arredondar centavo de centavo para zero", async () => {
    vi.doMock("@/actions/ai-settings", () => ({
      aiKeyUsage: async () => ({
        info: { usageUsd: 2, limitUsd: 10, dailyUsd: 0.1, weeklyUsd: 0.5, monthlyUsd: 1.2 },
        month: {
          byFeature: [
            { feature: "conversa_paga", calls: 5, costUsd: 0.0061 },
            { feature: "conversa_gratuita", calls: 5, costUsd: 0 },
            { feature: "jev", calls: 40, costUsd: 0.0008 },
          ],
          totalUsd: 0.0069,
          calls: 50,
        },
      }),
      saveAiKey: async () => ({}),
      removeAiKey: async () => ({}),
      saveQuoteModel: async () => ({}),
    }));
    vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
    vi.resetModules();
    const { AiSettings } = await import("@/components/house/ai-settings");
    render(
      <AiSettings
        status={{ source: "casa", keyHint: "…a1b2", quoteModel: "anthropic/claude-sonnet-5", quoteModelLocked: false }}
        canManage
      />,
    );
    await waitFor(() => expect(screen.getByText("Gasto com IA")).toBeTruthy());
    expect(screen.getByText("Hoje")).toBeTruthy();
    expect(screen.getByText(/US\$\s?1,20/)).toBeTruthy();
    expect(screen.getByText("Conversa (pago)")).toBeTruthy();
    expect(screen.getByText(/US\$\s?0,0061/)).toBeTruthy();
    expect(screen.getByText(/US\$\s?0,0008/)).toBeTruthy();
    expect(screen.getByText(/40 chamadas/)).toBeTruthy();
    expect(screen.getByText(/conta na cota de 50 chamadas/)).toBeTruthy();
  });

  it("com cotação: tudo em reais, e diz de onde veio a cotação", async () => {
    vi.doMock("@/actions/ai-settings", () => ({
      aiKeyUsage: async () => ({
        info: { usageUsd: 2, limitUsd: 10, dailyUsd: 0.1, weeklyUsd: 0.5, monthlyUsd: 1.2 },
        month: { byFeature: [{ feature: "jev", calls: 40, costUsd: 0.0008 }, { feature: "conversa_paga", calls: 5, costUsd: 0.4 }], totalUsd: 0.4008, calls: 45 },
        fx: { rate: 5.35, date: "2026-09-25", source: "PTAX" },
      }),
      saveAiKey: async () => ({}),
      removeAiKey: async () => ({}),
      saveQuoteModel: async () => ({}),
    }));
    vi.resetModules();
    const { AiSettings } = await import("@/components/house/ai-settings");
    render(
      <AiSettings
        status={{ source: "casa", keyHint: "…a1b2", quoteModel: "anthropic/claude-sonnet-5", quoteModelLocked: false }}
        canManage
      />,
    );
    await waitFor(() => expect(screen.getByText(/PTAX do Banco Central/)).toBeTruthy());
    // US$ 1,20 no mes = R$ 6,42; US$ 0,40 = R$ 2,14; US$ 0,0008 = menos de um centavo.
    expect(screen.getByText(/R\$\s?6,42/)).toBeTruthy();
    expect(screen.getByText(/R\$\s?2,14/)).toBeTruthy();
    expect(screen.getByText("< R$ 0,01")).toBeTruthy();
    // O total da chave em reais, com o dolar ao lado, e o limite em reais.
    expect(screen.getByText(/Total da chave: R\$\s?10,70 \(US\$\s?2,00\) de R\$\s?53,50 de limite/)).toBeTruthy();
    expect(screen.getByText(/IOF/)).toBeTruthy();
  });
});
