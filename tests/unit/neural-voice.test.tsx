import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * A voz neural da Conversa.
 *
 * O que guarda: a fala e dividida para a primeira frase tocar logo; os
 * pedacos sao pedidos juntos e tocados em ordem; se a voz neural falha, a
 * fala segue na voz do navegador e a neural fica desligada na pagina (sem
 * esperar de novo a cada frase); e a rota so fala para quem e da casa e tem
 * chave, com texto curto, pelo endpoint de fala do OpenRouter.
 */

describe("pedaços da fala", () => {
  it("primeira frase sozinha (curta demais junta com a próxima), o resto em blocos", async () => {
    const { speechChunks } = await import("@/lib/voice");
    expect(speechChunks("Pronto. Meta criada: Viagem. Quer mais alguma coisa?")).toEqual([
      "Pronto. Meta criada: Viagem.",
      "Quer mais alguma coisa?",
    ]);
    const longo = Array.from({ length: 12 }, (_, i) => `Frase número ${i} com algum conteúdo para falar.`).join(" ");
    const pedacos = speechChunks(longo);
    expect(pedacos.length).toBeGreaterThan(2);
    expect(pedacos.slice(1).every((p) => p.length <= 280)).toBe(true);
  });
});

describe("useSpeech", () => {
  const pedidos: string[] = [];
  const tocados: string[] = [];
  let fetchOriginal: typeof fetch;

  beforeEach(() => {
    vi.resetModules();
    pedidos.length = 0;
    tocados.length = 0;
    fetchOriginal = globalThis.fetch;
    let n = 0;
    globalThis.URL.createObjectURL = () => `blob:${(n += 1)}`;
    globalThis.URL.revokeObjectURL = () => {};
    (window as unknown as { Audio: unknown }).Audio = class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public src: string) {}
      play() {
        tocados.push(this.src);
        setTimeout(() => this.onended?.(), 0);
        return Promise.resolve();
      }
      pause() {}
    };
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: () => {},
      getVoices: () => [
        { name: "Português (Brasil)", lang: "pt-BR" },
        { name: "Google português do Brasil", lang: "pt-BR" },
      ],
      speak: (u: { text: string; voice: { name: string }; onend: () => void }) => {
        tocados.push(`navegador:${u.voice?.name}:${u.text}`);
        setTimeout(() => u.onend(), 0);
      },
    };
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      lang = "";
      rate = 1;
      voice: unknown = null;
      onend: () => void = () => {};
      onerror: () => void = () => {};
      constructor(public text: string) {}
    };
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("pede os pedaços juntos e toca em ordem, pela voz neural", async () => {
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      pedidos.push(JSON.parse(String(init.body)).text);
      return new Response(new Blob(["mp3"]), { headers: { "Content-Type": "audio/mpeg" } });
    }) as typeof fetch;
    const { useSpeech } = await import("@/lib/voice");
    const { result } = renderHook(() => useSpeech());
    await act(() => result.current.speak("Pronto, a meta Viagem foi criada. Quer mais alguma coisa?"));
    expect(pedidos).toEqual(["Pronto, a meta Viagem foi criada.", "Quer mais alguma coisa?"]);
    expect(tocados).toEqual(["blob:1", "blob:2"]);
  });

  it("voz neural falhou: fala pela melhor voz do navegador, e não tenta de novo na página", async () => {
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      pedidos.push(JSON.parse(String(init.body)).text);
      return new Response(JSON.stringify({ error: "Sem chave de IA." }), { status: 403, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const { useSpeech } = await import("@/lib/voice");
    const { result } = renderHook(() => useSpeech());
    await act(() => result.current.speak("Setembro está em R$ 320,00."));
    expect(tocados).toEqual(["navegador:Google português do Brasil:Setembro está em 320,00."]);
    const antes = pedidos.length;
    await act(() => result.current.speak("E agosto?"));
    expect(pedidos.length).toBe(antes);
  });
});

// ---------------------------------------------------------------------------

const rota = { casa: true, chave: "sk-or-da-casa" as string | null, usos: [] as unknown[] };
vi.mock("server-only", () => ({}));
vi.mock("@/actions/shared", () => ({
  requireHouseId: async () => {
    if (!rota.casa) throw new Error("Nenhuma casa ativa.");
    return "casa-1";
  },
}));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => rota.chave }));
vi.mock("@/lib/ai-usage", () => ({ recordAiUsage: async (...a: unknown[]) => rota.usos.push(a) }));

describe("rota /api/voz", () => {
  const post = (body: unknown) =>
    new Request("http://x/api/voz", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  let fetchOriginal: typeof fetch;
  const enviados: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  let respostas: Response[] = [];

  beforeEach(() => {
    rota.casa = true;
    rota.chave = "sk-or-da-casa";
    rota.usos.length = 0;
    enviados.length = 0;
    fetchOriginal = globalThis.fetch;
    respostas = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      enviados.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("Authorization") });
      return respostas.shift() ?? new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "Content-Type": "audio/pcm;rate=24000;channels=1" } });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("Gemini: pede PCM (o único formato que ele aceita) e devolve WAV tocável", async () => {
    const { POST } = await import("@/app/api/voz/route");
    const r = await POST(post({ text: "Setembro está em 320,00." }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/wav");
    const wav = new Uint8Array(await r.arrayBuffer());
    expect(wav.length).toBe(44 + 4);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(24_000);
    expect(enviados[0]).toEqual({
      url: "https://openrouter.ai/api/v1/audio/speech",
      body: { model: "google/gemini-3.8-flash-lite-tts", input: "Setembro está em 320,00.", voice: "Aoede", response_format: "pcm" },
      auth: "Bearer sk-or-da-casa",
    });
    expect(rota.usos[0]).toMatchObject(["casa-1", "voz", { calls: 1, details: { caracteres: 24, bytes: 48 } }]);
  });

  it("Gemini recusou: tenta a voz reserva em mp3, e o motivo fica no registro", async () => {
    respostas = [
      new Response(JSON.stringify({ error: { message: "voice not found" } }), { status: 400 }),
      new Response(new Uint8Array([9, 9]), { headers: { "Content-Type": "audio/mpeg" } }),
    ];
    const { POST } = await import("@/app/api/voz/route");
    const r = await POST(post({ text: "Oi" }));
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    expect(enviados[1]!.body).toMatchObject({ model: "openai/gpt-4o-mini-tts", voice: "coral", response_format: "mp3" });
    expect(rota.usos[0]).toMatchObject([
      "casa-1",
      "voz",
      { calls: 2, model: "openai/gpt-4o-mini-tts", details: { falhas: [{ modelo: "google/gemini-3.8-flash-lite-tts", status: 400, detalhe: expect.stringMatching(/voice not found/) }] } },
    ]);
  });

  it("nenhuma voz: 502, e as duas falhas ficam registradas", async () => {
    respostas = [new Response("x", { status: 400 }), new Response("y", { status: 404 })];
    const { POST } = await import("@/app/api/voz/route");
    expect((await POST(post({ text: "Oi" }))).status).toBe(502);
    expect(rota.usos[0]).toMatchObject(["casa-1", "voz", { calls: 2, details: { erro: true, falhas: [{ status: 400 }, { status: 404 }] } }]);
  });

  it("sem casa, sem chave ou texto longo demais: recusa sem chamar o OpenRouter", async () => {
    const { POST } = await import("@/app/api/voz/route");
    expect((await POST(post({ text: "x".repeat(601) }))).status).toBe(400);
    rota.chave = null;
    expect((await POST(post({ text: "oi" }))).status).toBe(403);
    rota.casa = false;
    expect((await POST(post({ text: "oi" }))).status).toBe(401);
    expect(enviados).toHaveLength(0);
  });
});
