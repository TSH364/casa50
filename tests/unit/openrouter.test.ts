import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { chatCompletion, checkKey, DEFAULT_MODEL, OpenRouterError } = await import(
  "@/lib/openrouter"
);

/**
 * O cliente do OpenRouter.
 *
 * O que guarda: o que exatamente sai do servidor em cada chamada - a chave no
 * cabecalho e nao no corpo, a restricao de provedores que guardam dados, e a
 * AUSENCIA do `response_format`, que combinado com a restricao de dados faz
 * toda chamada morrer com 404. E que cada falha vira uma frase em portugues
 * que diz o que fazer.
 */

const CHAVE = "sk-or-teste";

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
  it("chama o endpoint do OpenRouter com a chave no cabeçalho", async () => {
    const { chamadas, fetchImpl } = capturar();
    await chatCompletion(PERGUNTA, { apiKey: CHAVE, fetchImpl });

    expect(chamadas[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = chamadas[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${CHAVE}`);
    // A chave nunca no corpo: corpo de requisicao vai parar em log.
    expect(String(chamadas[0]?.init.body)).not.toContain(CHAVE);
  });

  it("só aceita provedor que não guarda os dados", async () => {
    const { chamadas, fetchImpl } = capturar();
    await chatCompletion(PERGUNTA, { apiKey: CHAVE, fetchImpl });
    const corpo = JSON.parse(String(chamadas[0]?.init.body));
    expect(corpo.provider).toEqual({ data_collection: "deny" });
  });

  it("NÃO pede response_format", async () => {
    // Combinado com a restricao de dados, o esquema de resposta filtra todos
    // os provedores e a chamada morre com 404 - ha registro publico disso. O
    // JSON e pedido no texto e conferido na volta.
    const { chamadas, fetchImpl } = capturar();
    await chatCompletion(PERGUNTA, { apiKey: CHAVE, fetchImpl });
    const corpo = JSON.parse(String(chamadas[0]?.init.body));
    expect(corpo).not.toHaveProperty("response_format");
    expect(corpo.temperature).toBe(0);
  });

  it("usa o modelo pedido, e o padrão quando nenhum vem", async () => {
    const a = capturar();
    await chatCompletion(PERGUNTA, { apiKey: CHAVE, fetchImpl: a.fetchImpl });
    expect(JSON.parse(String(a.chamadas[0]?.init.body)).model).toBe(DEFAULT_MODEL);

    const b = capturar();
    await chatCompletion(PERGUNTA, {
      apiKey: CHAVE,
      model: "google/gemini-3.6-flash",
      fetchImpl: b.fetchImpl,
    });
    expect(JSON.parse(String(b.chamadas[0]?.init.body)).model).toBe("google/gemini-3.6-flash");
  });

  it("devolve o texto da resposta", async () => {
    const { fetchImpl } = capturar(respostaOk('{"total":10}'));
    expect(await chatCompletion(PERGUNTA, { apiKey: CHAVE, fetchImpl })).toBe('{"total":10}');
  });

  it.each([
    [401, /chave do OpenRouter não foi aceita/],
    [402, /sem créditos/],
    [404, /Nenhum provedor disponível/],
    [429, /Espere um minuto/],
    [503, /problema agora/],
  ])("HTTP %i vira uma frase que diz o que fazer", async (status, frase) => {
    const { fetchImpl } = capturar(new Response("{}", { status }));
    await expect(chatCompletion(PERGUNTA, { apiKey: CHAVE, fetchImpl })).rejects.toThrow(frase);
  });

  it("erro dentro de um 200 também é erro", async () => {
    // O OpenRouter as vezes aceita a chamada e o provedor falha depois: o
    // status e 200 e o erro vem no corpo.
    const { fetchImpl } = capturar(
      new Response(JSON.stringify({ error: { message: "provider down", code: 502 } }), {
        status: 200,
      }),
    );
    await expect(chatCompletion(PERGUNTA, { apiKey: CHAVE, fetchImpl })).rejects.toBeInstanceOf(
      OpenRouterError,
    );
  });

  it("resposta vazia é erro, e não texto vazio", async () => {
    const { fetchImpl } = capturar(respostaOk("   "));
    await expect(chatCompletion(PERGUNTA, { apiKey: CHAVE, fetchImpl })).rejects.toThrow(/vazio/);
  });

  it("sem chave, não chama nada", async () => {
    const { chamadas, fetchImpl } = capturar();
    await expect(chatCompletion(PERGUNTA, { apiKey: null, fetchImpl })).rejects.toThrow(
      /não está configurada/,
    );
    expect(chamadas).toHaveLength(0);
  });
});

describe("checkKey", () => {
  it("lê gasto e limite da chave, sem gastar crédito", async () => {
    const { chamadas, fetchImpl } = capturar(
      new Response(JSON.stringify({ data: { label: "x", usage: 0.42, limit: 5 } }), {
        status: 200,
      }),
    );
    expect(await checkKey(CHAVE, fetchImpl)).toEqual({ usageUsd: 0.42, limitUsd: 5 });
    expect(chamadas[0]?.url).toBe("https://openrouter.ai/api/v1/key");
    // Consulta, e nao chamada de modelo: sem corpo, sem metodo POST.
    expect(chamadas[0]?.init.method).toBeUndefined();
  });

  it("chave sem limite vem com limite nulo, e não zero", async () => {
    // Zero seria "limite de zero dolares" - o contrario do que e.
    const { fetchImpl } = capturar(
      new Response(JSON.stringify({ data: { usage: 1, limit: null } }), { status: 200 }),
    );
    expect((await checkKey(CHAVE, fetchImpl)).limitUsd).toBeNull();
  });

  it("chave recusada diz para conferir se foi copiada inteira", async () => {
    const { fetchImpl } = capturar(new Response("{}", { status: 401 }));
    await expect(checkKey(CHAVE, fetchImpl)).rejects.toThrow(/copiou inteira/);
  });

  it("sem rede, a falha é de rede — e não 'chave inválida'", async () => {
    // A tela precisa distinguir os dois: chave errada nao se guarda; rede fora
    // do ar nao e motivo para recusar uma chave boa.
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(checkKey(CHAVE, fetchImpl)).rejects.toMatchObject({ status: 0 });
  });
});
