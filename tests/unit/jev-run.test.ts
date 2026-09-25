import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { decide, OpenRouterError } = await import("@/lib/openrouter");
const { runJev } = await import("@/lib/jev-run");

/**
 * O cliente do Jev e a fila de perguntas.
 *
 * O que guarda: o endereco e o corpo que saem (a API de decisoes, nao o chat,
 * e a chave so no cabecalho); que resposta com chave inventada ou sem
 * probabilidade nao passa; e os tres freios da fila - teto de chamadas,
 * prazo, e parar na primeira recusa que valeria para todas.
 */

const CHAVE = "sk-or-teste";
const PERGUNTAS = {
  categoria: {
    type: "choice" as const,
    instructions: "Qual?",
    criteria: { alimentacao: "comida", transporte: "carro" },
  },
};

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status });
}

function ok(choice = "transporte", p = 0.9) {
  return json({
    answers: { categoria: { type: "choice", choice, probabilities: { [choice]: p }, confidence: p } },
    usage: { input_tokens: 400, output_tokens: 60, cost: 0.00002 },
  });
}

describe("decide", () => {
  it("chama a API de decisões com o Jev e a chave no cabeçalho", async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return ok();
    }) as unknown as typeof fetch;

    const r = await decide("UBER", PERGUNTAS, { apiKey: CHAVE, model: "typesafe/jev-1.13", fetchImpl });

    expect(chamadas[0]?.url).toBe("https://openrouter.ai/api/alpha/decisions");
    const corpo = JSON.parse(String(chamadas[0]?.init.body));
    expect(corpo).toEqual({ model: "typesafe/jev-1.13", state: "UBER", questions: PERGUNTAS });
    expect(String(chamadas[0]?.init.body)).not.toContain(CHAVE);
    expect((chamadas[0]?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CHAVE}`);
    expect(r.categoria).toEqual({ choice: "transporte", probabilities: { transporte: 0.9 }, confidence: 0.9 });
  });

  it("escolha fora das opções, ou sem probabilidade, não passa", async () => {
    for (const resposta of [
      ok("inventada"),
      json({ answers: { categoria: { choice: "transporte", probabilities: {} } } }),
      json({ answers: { categoria: { choice: "transporte", probabilities: { transporte: 7 } } } }),
    ]) {
      const fetchImpl = (async () => resposta) as unknown as typeof fetch;
      expect(await decide("x", PERGUNTAS, { apiKey: CHAVE, model: "m", fetchImpl })).toEqual({});
    }
  });

  it("erro dentro de uma resposta 200 vira erro", async () => {
    const fetchImpl = (async () => json({ error: { code: 402, message: "no credits" } })) as unknown as typeof fetch;
    await expect(decide("x", PERGUNTAS, { apiKey: CHAVE, model: "m", fetchImpl })).rejects.toMatchObject({
      status: 402,
    });
  });

  it("sem chave nem tenta", async () => {
    const fetchImpl = vi.fn();
    await expect(
      decide("x", PERGUNTAS, { apiKey: null, model: "m", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(OpenRouterError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("runJev", () => {
  const jobs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `loja-${i}`, state: `loja ${i}`, questions: PERGUNTAS }));

  it("responde todas, no máximo seis de cada vez", async () => {
    let emVoo = 0;
    let pico = 0;
    const fetchImpl = (async () => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo -= 1;
      return ok();
    }) as unknown as typeof fetch;

    const r = await runJev(jobs(20), { apiKey: CHAVE, fetchImpl });
    expect(r.answers.size).toBe(20);
    expect(pico).toBeLessThanOrEqual(6);
    expect(r.stoppedBy).toBeNull();
  });

  it("teto de chamadas: o resto fica sem palpite, e a tela é avisada", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const r = await runJev(jobs(10), { apiKey: CHAVE, maxJobs: 4, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(r.skipped).toBe(6);
    expect(r.stoppedBy).toMatch(/não chegou a ver todos/);
  });

  it("chave recusada: para na primeira, em vez de repetir a recusa", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "unauthorized" }, 401));
    const r = await runJev(jobs(30), {
      apiKey: CHAVE,
      concurrency: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.stoppedBy).toMatch(/não aceitou a chave/);
    expect(r.skipped).toBe(29);
  });

  it("falha de uma loja não derruba as outras", async () => {
    let n = 0;
    const fetchImpl = (async () => (++n === 2 ? json({}, 500) : ok())) as unknown as typeof fetch;
    const r = await runJev(jobs(5), { apiKey: CHAVE, concurrency: 1, fetchImpl });
    expect(r.answers.size).toBe(4);
    expect(r.failed).toBe(1);
  });

  it("passado o prazo, o que não começou não começa", async () => {
    let agora = 0;
    const fetchImpl = (async () => {
      agora += 10_000;
      return ok();
    }) as unknown as typeof fetch;
    const r = await runJev(jobs(10), {
      apiKey: CHAVE,
      concurrency: 1,
      deadlineMs: 25_000,
      now: () => agora,
      fetchImpl,
    });
    expect(r.answers.size).toBe(3);
    expect(r.skipped).toBe(7);
  });
});
