import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { chatTurn, chatCompletion } = await import("@/lib/openrouter");

/**
 * Uma rodada da conversa no OpenRouter.
 *
 * O que guarda: a conversa LIBERA provedor que guarda dados (a casa escolheu
 * o gratuito), e a leitura de orcamento continua recusando - as duas nao
 * podem se misturar; as ferramentas vao, e somem na rodada de fechar; a
 * chamada de ferramenta volta lida; e as falhas tipicas do gratuito viram
 * frase que diz o que fazer.
 */

const TOOLS = [{ type: "function" as const, function: { name: "resumo_do_mes", description: "x", parameters: {} } }];

function captura(resposta: unknown, status = 200) {
  const corpos: Record<string, unknown>[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    corpos.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(resposta), { status });
  }) as unknown as typeof fetch;
  return { corpos, fetchImpl };
}

const PERGUNTA = [{ role: "user" as const, content: "quanto gastamos?" }];

describe("chatTurn", () => {
  it("conversa libera provedor que guarda; orçamento continua recusando", async () => {
    const a = captura({ choices: [{ message: { content: "oi" } }] });
    await chatTurn(PERGUNTA, { apiKey: "k", model: "openrouter/free", tools: TOOLS, allowDataCollection: true, fetchImpl: a.fetchImpl });
    expect(a.corpos[0]?.provider).toEqual({ data_collection: "allow" });

    const b = captura({ choices: [{ message: { content: "{}" } }] });
    await chatCompletion(PERGUNTA, { apiKey: "k", fetchImpl: b.fetchImpl });
    expect(b.corpos[0]?.provider).toEqual({ data_collection: "deny" });
  });

  it("manda as ferramentas; na rodada de fechar, não", async () => {
    const a = captura({ choices: [{ message: { content: "oi" } }] });
    await chatTurn(PERGUNTA, { apiKey: "k", model: "m", tools: TOOLS, allowDataCollection: true, fetchImpl: a.fetchImpl });
    expect(a.corpos[0]).toMatchObject({ tools: TOOLS, tool_choice: "auto" });

    const b = captura({ choices: [{ message: { content: "oi" } }] });
    await chatTurn(PERGUNTA, { apiKey: "k", model: "m", tools: [], allowDataCollection: true, fetchImpl: b.fetchImpl });
    expect(b.corpos[0]).not.toHaveProperty("tools");
  });

  it("lê o pedido de ferramenta e o modelo que respondeu", async () => {
    const { fetchImpl } = captura({
      model: "google/gemma-4-31b-it:free",
      choices: [{ message: { content: null, tool_calls: [
        { id: "c1", type: "function", function: { name: "resumo_do_mes", arguments: '{"mes":"2026-09"}' } },
        { id: 7, function: {} },
      ] } }],
    });
    const r = await chatTurn(PERGUNTA, { apiKey: "k", model: "m", tools: TOOLS, allowDataCollection: true, fetchImpl });
    expect(r.toolCalls).toEqual([
      { id: "c1", type: "function", function: { name: "resumo_do_mes", arguments: '{"mes":"2026-09"}' } },
    ]);
    expect(r.servedBy).toBe("google/gemma-4-31b-it:free");
  });

  it("404 explica a opção de privacidade; 429, a cota do gratuito", async () => {
    const a = captura({ error: { message: "No endpoints found matching your data policy" } }, 404);
    await expect(
      chatTurn(PERGUNTA, { apiKey: "k", model: "m", tools: TOOLS, allowDataCollection: true, fetchImpl: a.fetchImpl }),
    ).rejects.toThrow(/Settings → Privacy/);
    const b = captura({ error: { code: 429, message: "free-models-per-day" } });
    await expect(
      chatTurn(PERGUNTA, { apiKey: "k", model: "m", tools: TOOLS, allowDataCollection: true, fetchImpl: b.fetchImpl }),
    ).rejects.toThrow(/50 chamadas por dia/);
  });

  it("resposta vazia é erro, não uma bolha em branco", async () => {
    const { fetchImpl } = captura({ choices: [{ message: { content: "  " } }] });
    await expect(
      chatTurn(PERGUNTA, { apiKey: "k", model: "m", tools: TOOLS, allowDataCollection: true, fetchImpl }),
    ).rejects.toThrow(/vazio/);
  });
});
