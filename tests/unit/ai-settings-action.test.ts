import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As acoes da configuracao de IA.
 *
 * O que guarda: a chave e TESTADA antes de guardar, e chave recusada nao
 * entra; falha de rede nao recusa chave boa; a chave da Vercel vence e a tela
 * nao grava uma que nao valeria; e nenhuma resposta devolve a chave.
 */

const estado = {
  checar: "ok" as "ok" | "recusada" | "sem-rede",
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  erroRpc: null as { code: string } | null,
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => "sk-or-da-casa" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.rpc.push({ fn, args });
      return estado.erroRpc
        ? { data: null, error: estado.erroRpc }
        : { data: fn === "set_ai_key" ? "…0123" : null, error: null };
    },
  }),
}));
vi.mock("@/lib/openrouter", async () => {
  class OpenRouterError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  return {
    OpenRouterError,
    checkKey: async () => {
      if (estado.checar === "recusada") {
        throw new OpenRouterError("O OpenRouter recusou esta chave. Confira se copiou inteira.", 401);
      }
      if (estado.checar === "sem-rede") throw new OpenRouterError("sem rede", 0);
      return { usageUsd: 0, limitUsd: 5 };
    },
  };
});

const { saveAiKey, removeAiKey, saveQuoteModel } = await import("@/actions/ai-settings");

const CHAVE = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123";

describe("saveAiKey", () => {
  beforeEach(() => {
    estado.checar = "ok";
    estado.rpc = [];
    estado.erroRpc = null;
    vi.stubEnv("OPENROUTER_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("testa e guarda — e a resposta traz só o final da chave", async () => {
    const r = await saveAiKey({ key: CHAVE });
    expect(r).toMatchObject({ ok: true, hint: "…0123", info: { limitUsd: 5 } });
    expect(estado.rpc).toEqual([{ fn: "set_ai_key", args: { p_house: "casa-1", p_key: CHAVE } }]);
    // Nada do que volta ao navegador contem a chave.
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });

  it("chave recusada pelo OpenRouter NÃO é guardada", async () => {
    estado.checar = "recusada";
    const r = await saveAiKey({ key: CHAVE });
    expect(r.error).toMatch(/recusou/);
    expect(estado.rpc).toHaveLength(0);
  });

  it("sem rede, guarda assim mesmo, e avisa que não testou", async () => {
    // Rede fora do ar nao e motivo para recusar uma chave que pode estar boa.
    estado.checar = "sem-rede";
    const r = await saveAiKey({ key: CHAVE });
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/Não consegui testar/);
    expect(estado.rpc).toHaveLength(1);
  });

  it("formato errado nem chega ao OpenRouter", async () => {
    const r = await saveAiKey({ key: "minha-senha" });
    expect(r.error).toMatch(/sk-or-/);
    expect(estado.rpc).toHaveLength(0);
  });

  it("com chave na Vercel, recusa guardar outra que não valeria", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-da-vercel");
    const r = await saveAiKey({ key: CHAVE });
    expect(r.error).toMatch(/Vercel/);
    expect(estado.rpc).toHaveLength(0);
  });

  it("recusa do banco por papel vira frase de gente", async () => {
    estado.erroRpc = { code: "42501" };
    const r = await saveAiKey({ key: CHAVE });
    expect(r.error).toMatch(/Só dono ou administrador/);
  });
});

describe("removeAiKey e saveQuoteModel", () => {
  beforeEach(() => {
    estado.rpc = [];
    estado.erroRpc = null;
  });

  it("apagar chama a função que tira do Vault", async () => {
    expect(await removeAiKey()).toEqual({ ok: true });
    expect(estado.rpc[0]?.fn).toBe("clear_ai_key");
  });

  it("só aceita modelo da lista", async () => {
    expect((await saveQuoteModel({ model: "qualquer/coisa" })).error).toMatch(/não reconhecido/);
    expect(estado.rpc).toHaveLength(0);
    expect(await saveQuoteModel({ model: "google/gemini-3.6-flash" })).toEqual({ ok: true });
  });
});
