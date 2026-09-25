import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/openrouter";

/**
 * A acao de ler orcamento com IA.
 *
 * O que guarda: que a casa e conferida ANTES de qualquer coisa - server
 * action e endereco publico, e sem isso qualquer um gastaria os creditos do
 * OpenRouter da casa -, e que so o documento sai, nada mais.
 */

const estado = {
  casa: true as boolean,
  configurado: true as boolean,
  resposta: '{"fornecedor":"Loja","total":100}' as string,
  mensagens: [] as ChatMessage[][],
  chaves: [] as string[],
};

vi.mock("@/actions/shared", () => ({
  requireHouseId: async () => {
    if (!estado.casa) throw new Error("Nenhuma casa ativa.");
    return "casa-1";
  },
}));

vi.mock("@/lib/ai-config", () => ({
  getAiKey: async () => (estado.configurado ? "sk-or-da-casa" : null),
  getAiStatus: async () => ({
    source: estado.configurado ? "casa" : null,
    keyHint: null,
    quoteModel: "anthropic/claude-sonnet-5",
    quoteModelLocked: false,
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
    chatCompletion: async (messages: ChatMessage[], opcoes: { apiKey: string }) => {
      estado.chaves.push(opcoes.apiKey);
      estado.mensagens.push(messages);
      if (estado.resposta === "ERRO") throw new OpenRouterError("A conta do OpenRouter está sem créditos.", 402);
      return estado.resposta;
    },
  };
});

const { readQuoteWithAI } = await import("@/actions/quote-ai");

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("readQuoteWithAI", () => {
  beforeEach(() => {
    estado.casa = true;
    estado.configurado = true;
    estado.resposta = '{"fornecedor":"Loja","total":100}';
    estado.mensagens = [];
    estado.chaves = [];
  });

  it("usa a chave da casa, decriptada no servidor", async () => {
    await readQuoteWithAI({ kind: "text", text: "Total 100,00" });
    expect(estado.chaves).toEqual(["sk-or-da-casa"]);
  });

  it("sem casa, recusa antes de chamar a IA — e antes de dizer se ela existe", async () => {
    estado.casa = false;
    await expect(readQuoteWithAI({ kind: "text", text: "Total 100,00" })).rejects.toThrow();
    expect(estado.mensagens).toHaveLength(0);
  });

  it("sem chave configurada, diz isso e não chama nada", async () => {
    estado.configurado = false;
    const r = await readQuoteWithAI({ kind: "text", text: "Total 100,00" });
    expect(r).toMatchObject({ configured: false });
    expect(estado.mensagens).toHaveLength(0);
  });

  it("manda o texto do documento e o pedido — e nada mais", async () => {
    const r = await readQuoteWithAI({ kind: "text", text: "Loja\nTotal 100,00" });
    expect(r.proposal?.total).toMatchObject({ cents: 10_000, confidence: "alta" });

    const [sistema, usuario] = estado.mensagens[0]!;
    expect(sistema?.role).toBe("system");
    // O que vai ao modelo e o documento. Nome do item, previsto, fornecedor ja
    // digitado - nada disso entra, porque o modelo nao precisa.
    const enviado = JSON.stringify(usuario?.content);
    expect(enviado).toContain("Total 100,00");
    expect(estado.mensagens[0]).toHaveLength(2);
  });

  it("manda cada página como uma imagem, na ordem", async () => {
    await readQuoteWithAI({ kind: "image", dataUrls: [JPEG, JPEG, JPEG] });
    const partes = estado.mensagens[0]![1]!.content as { type: string }[];
    expect(partes.filter((p) => p.type === "image_url")).toHaveLength(3);
  });

  it("recusa mais de três páginas, formato estranho e texto vazio", async () => {
    for (const entrada of [
      { kind: "image", dataUrls: [JPEG, JPEG, JPEG, JPEG] },
      { kind: "image", dataUrls: ["data:image/heic;base64,AAAA"] },
      { kind: "image", dataUrls: ["https://exemplo.com/foto.jpg"] },
      { kind: "text", text: "" },
    ]) {
      const r = await readQuoteWithAI(entrada);
      expect(r.error).toMatch(/formato não aceito/);
    }
    expect(estado.mensagens).toHaveLength(0);
  });

  it("imagem lida vem marcada como não conferida", async () => {
    const r = await readQuoteWithAI({ kind: "image", dataUrls: [JPEG] });
    expect(r.proposal?.total?.confidence).toBe("media");
  });

  it("resposta sem JSON vira erro, para a tela cair no leitor por regra", async () => {
    estado.resposta = "Desculpe, não consigo ler.";
    const r = await readQuoteWithAI({ kind: "text", text: "Total 100,00" });
    expect(r.proposal).toBeUndefined();
    expect(r.error).toMatch(/formato que não entendi/);
  });

  it("falha do OpenRouter chega como a frase dele", async () => {
    estado.resposta = "ERRO";
    const r = await readQuoteWithAI({ kind: "text", text: "Total 100,00" });
    expect(r.error).toBe("A conta do OpenRouter está sem créditos.");
  });
});
