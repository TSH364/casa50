import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { chatCompletion, DEFAULT_MODEL, isOpenRouterConfigured, OpenRouterError } =
  await import("@/lib/openrouter");

/**
 * O cliente do OpenRouter.
 *
 * O que guarda: o que exatamente sai do servidor em cada chamada - a chave no
 * cabecalho e nao no corpo, a restricao de provedores que guardam dados, e a
 * AUSENCIA do `response_format`, que combinado com a restricao de dados faz
 * toda chamada morrer com 404. E que cada falha vira uma frase em portugues
 * que diz o que fazer.
 */

function respostaOk(conteudo: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), {
    status: 200,
  });
}

function capturar(resposta: Response = respostaOk("{}")) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    return resposta;
  }) as unknown as typeof fetch;
  return { chamadas, fetchImpl };
}

const PERGUNTA = [{ role: "user" as const, content: "oi" }];

describe("chatCompletion", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-teste");
    vi.stubEnv("OPENROUTER_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("chama o endpoint do OpenRouter com a chave no cabeçalho", async () => {
    const { chamadas, fetchImpl } = capturar();
    await chatCompletion(PERGUNTA, { fetchImpl });

    expect(chamadas[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = chamadas[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-teste");
    // A chave nunca no corpo: corpo de requisicao vai parar em log.
    expect(String(chamadas[0]?.init.body)).not.toContain("sk-or-teste");
  });

  it("só aceita provedor que não guarda os dados", async () => {
    const { chamadas, fetchImpl } = capturar();
    await chatCompletion(PERGUNTA, { fetchImpl });
    const corpo = JSON.parse(String(chamadas[0]?.init.body));
    expect(corpo.provider).toEqual({ data_collection: "deny" });
  });

  it("NÃO pede response_format", async () => {
    // Combinado com a restricao de dados, o esquema de resposta filtra todos
    // os provedores e a chamada morre com 404 - ha registro publico disso. O
    // JSON e pedido no texto e conferido na volta.
    const { chamadas, fetchImpl } = capturar();
    await chatCompletion(PERGUNTA, { fetchImpl });
    const corpo = JSON.parse(String(chamadas[0]?.init.body));
    expect(corpo).not.toHaveProperty("response_format");
    expect(corpo.temperature).toBe(0);
  });

  it("usa o modelo padrão, e o da variável quando definida", async () => {
    const a = capturar();
    await chatCompletion(PERGUNTA, { fetchImpl: a.fetchImpl });
    expect(JSON.parse(String(a.chamadas[0]?.init.body)).model).toBe(DEFAULT_MODEL);

    vi.stubEnv("OPENROUTER_MODEL", "google/gemini-3.6-flash");
    const b = capturar();
    await chatCompletion(PERGUNTA, { fetchImpl: b.fetchImpl });
    expect(JSON.parse(String(b.chamadas[0]?.init.body)).model).toBe("google/gemini-3.6-flash");
  });

  it("devolve o texto da resposta", async () => {
    const { fetchImpl } = capturar(respostaOk('{"total":10}'));
    expect(await chatCompletion(PERGUNTA, { fetchImpl })).toBe('{"total":10}');
  });

  it.each([
    [401, /chave do OpenRouter não foi aceita/],
    [402, /sem créditos/],
    [404, /Nenhum provedor disponível/],
    [429, /Espere um minuto/],
    [503, /problema agora/],
  ])("HTTP %i vira uma frase que diz o que fazer", async (status, frase) => {
    const { fetchImpl } = capturar(new Response("{}", { status }));
    await expect(chatCompletion(PERGUNTA, { fetchImpl })).rejects.toThrow(frase);
  });

  it("erro dentro de um 200 também é erro", async () => {
    // O OpenRouter as vezes aceita a chamada e o provedor falha depois: o
    // status e 200 e o erro vem no corpo.
    const { fetchImpl } = capturar(
      new Response(JSON.stringify({ error: { message: "provider down", code: 502 } }), {
        status: 200,
      }),
    );
    await expect(chatCompletion(PERGUNTA, { fetchImpl })).rejects.toBeInstanceOf(OpenRouterError);
  });

  it("resposta vazia é erro, e não texto vazio", async () => {
    const { fetchImpl } = capturar(respostaOk("   "));
    await expect(chatCompletion(PERGUNTA, { fetchImpl })).rejects.toThrow(/vazio/);
  });

  it("sem chave, não chama nada", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const { chamadas, fetchImpl } = capturar();
    expect(isOpenRouterConfigured()).toBe(false);
    await expect(chatCompletion(PERGUNTA, { fetchImpl })).rejects.toThrow(/não está configurada/);
    expect(chamadas).toHaveLength(0);
  });
});
