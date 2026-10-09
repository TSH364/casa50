import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Secretario - ler o Gmail e o login do Google, com banco, Gmail e IA falsos.
 *
 * O que guarda: o que ja foi lido nao vai de novo a IA; do e-mail so o
 * resumo, o valor e as datas sao gravados (o corpo nao); sem chave de IA o
 * Gmail nem e aberto; autorizacao vencida fica anotada na conexao; resposta
 * da IA fora do formato nao grava nada (o lote volta na proxima leitura); e o
 * retorno do Google confere o `state` antes de guardar o token.
 */

const estado = {
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  upserts: [] as Record<string, unknown>[][],
  jaLidos: [] as string[],
  chave: "sk-or-casa" as string | null,
  respostaIa: "",
  erroGmail: null as Error | null,
  usos: [] as { feature: string; calls: number }[],
  cookie: "estado-certo" as string | undefined,
};

const conexao = { id: "c1", member_id: "u1", email_address: "vini@gmail.com", refresh_token: "rt", last_sync_at: null };

function fakeSupabase() {
  return {
    rpc: (nome: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ nome, args });
      if (nome === "email_connection_secrets") return Promise.resolve({ data: [conexao], error: null });
      if (nome === "claim_email_sync") return Promise.resolve({ data: ["c1"], error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: (tabela: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "limit", "update", "neq"]) b[m] = () => b;
      b.upsert = (linhas: Record<string, unknown>[]) => {
        estado.upserts.push(linhas);
        return Promise.resolve({ error: null });
      };
      b.then = (ok: (r: unknown) => unknown) =>
        Promise.resolve(
          tabela === "email_items" ? { data: estado.jaLidos.map((g) => ({ gmail_id: g })), error: null } : { data: [], error: null },
        ).then(ok);
      return b;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeSupabase(),
  getCurrentUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => estado.chave }));
vi.mock("@/lib/ai-usage", () => ({
  recordAiUsage: async (_h: string, feature: string, u: { calls: number }) => estado.usos.push({ feature, calls: u.calls }),
}));
vi.mock("@/lib/openrouter", () => ({
  OpenRouterError: class extends Error {},
  chatCompletion: vi.fn(async () => estado.respostaIa),
}));

const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mensagem = (id: string, assunto: string, texto: string) => ({
  id,
  internalDate: String(Date.UTC(2026, 9, 8, 12)),
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Condominio <adm@condominio.com.br>" },
      { name: "Subject", value: assunto },
    ],
    body: { data: b64(texto) },
  },
});

vi.mock("@/lib/gmail", async () => {
  class GmailError extends Error {
    constructor(message: string, readonly reconectar = false) {
      super(message);
    }
  }
  return {
    GmailError,
    credenciaisGoogle: () => ({ clientId: "cid", clientSecret: "cs" }),
    tokenDeAcesso: async () => {
      if (estado.erroGmail) throw estado.erroGmail;
      return "at";
    },
    listarMensagens: async () => ["msg-0001", "msg-0002"],
    lerMensagem: async (_t: string, id: string) =>
      id === "msg-0001"
        ? mensagem(id, "Boleto do condominio", "Segue o boleto. Valor R$ 850,00, vencimento 15/10/2026. SEGREDO-DO-CORPO")
        : mensagem(id, "Assembleia", "Assembleia dia 20/10."),
    trocarCodigo: async () => ({ refreshToken: "rt-novo", accessToken: "at" }),
    enderecoDaConta: async () => "vini@gmail.com",
    urlDeAutorizacao: () => "https://accounts.google.com/x",
  };
});

beforeEach(() => {
  estado.rpcs = [];
  estado.upserts = [];
  estado.jaLidos = [];
  estado.chave = "sk-or-casa";
  estado.erroGmail = null;
  estado.usos = [];
  estado.respostaIa = JSON.stringify({
    emails: [
      { n: 1, tipo: "conta", resumo: "Condomínio de outubro", valor: "R$ 850,00", vencimento: "2026-10-15", data: null },
      { n: 2, tipo: "compromisso", resumo: "Assembleia do condomínio", valor: null, vencimento: null, data: "2026-10-20" },
    ],
  });
});

const marcas = () => estado.rpcs.filter((r) => r.nome === "mark_email_sync").map((r) => r.args.p_error);

describe("ler o Gmail", () => {
  it("grava o resumo, o valor e as datas, nunca o corpo; anota a leitura e o gasto", async () => {
    const { lerEmailsAgora } = await import("@/actions/secretario");
    const r = await lerEmailsAgora();
    expect(r).toEqual({ novos: 2, erros: [] });
    const linhas = estado.upserts.flat();
    expect(linhas).toMatchObject([
      { gmail_id: "msg-0001", kind: "conta", summary: "Condomínio de outubro", amount: 850, due_date: "2026-10-15", connection_id: "c1", member_id: "u1" },
      { gmail_id: "msg-0002", kind: "compromisso", event_date: "2026-10-20" },
    ]);
    expect(JSON.stringify(linhas)).not.toContain("SEGREDO-DO-CORPO");
    expect(marcas()).toEqual([null]);
    expect(estado.usos).toEqual([{ feature: "secretario", calls: 1 }]);
  });

  it("o que já foi lido não vai de novo à IA", async () => {
    estado.jaLidos = ["msg-0001", "msg-0002"];
    const { chatCompletion } = await import("@/lib/openrouter");
    vi.mocked(chatCompletion).mockClear();
    const { lerEmailsAgora } = await import("@/actions/secretario");
    expect(await lerEmailsAgora()).toEqual({ novos: 0, erros: [] });
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("sem chave de IA, o Gmail nem é aberto, e a conexão diz por quê", async () => {
    estado.chave = null;
    const { lerEmailsAgora } = await import("@/actions/secretario");
    const r = await lerEmailsAgora();
    expect(r.erros[0]).toMatch(/IA não está configurada/);
    expect(estado.upserts).toEqual([]);
    expect(marcas()[0]).toMatch(/IA não está configurada/);
  });

  it("autorização vencida fica anotada", async () => {
    const { GmailError } = await import("@/lib/gmail");
    estado.erroGmail = new GmailError("Conecte o Gmail de novo em Casa.", true);
    const { lerEmailsAgora } = await import("@/actions/secretario");
    await lerEmailsAgora();
    expect(marcas()).toEqual(["Conecte o Gmail de novo em Casa."]);
  });

  it("resposta fora do formato: nada gravado, erro anotado", async () => {
    estado.respostaIa = "não sei";
    const { lerEmailsAgora } = await import("@/actions/secretario");
    await lerEmailsAgora();
    expect(estado.upserts).toEqual([]);
    expect(marcas()).toEqual(["A IA respondeu num formato inesperado."]);
  });

  it("a abertura do app lê só o que reservou", async () => {
    const { syncSecretario } = await import("@/actions/secretario");
    await syncSecretario();
    expect(estado.rpcs.map((r) => r.nome)).toEqual(["claim_email_sync", "email_connection_secrets", "mark_email_sync"]);
  });
});

vi.mock("@/lib/env", () => ({ siteUrl: () => "http://localhost:3000" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (estado.cookie ? { value: estado.cookie } : undefined) }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

describe("a volta do Google", () => {
  it("state diferente do cookie: não guarda nada", async () => {
    const { GET } = await import("@/app/api/gmail/retorno/route");
    const r = await GET(new Request("http://localhost:3000/api/gmail/retorno?code=abc&state=outro"));
    expect(r.headers.get("location")).toBe("http://localhost:3000/casa?gmail=expirou");
    expect(estado.rpcs).toEqual([]);
  });

  it("state certo: guarda o token com o endereço da conta e leva ao secretário", async () => {
    const { GET } = await import("@/app/api/gmail/retorno/route");
    const r = await GET(new Request("http://localhost:3000/api/gmail/retorno?code=abc&state=estado-certo"));
    expect(estado.rpcs).toEqual([
      { nome: "set_email_connection", args: { p_house: "casa-1", p_email: "vini@gmail.com", p_refresh_token: "rt-novo" } },
    ]);
    expect(r.headers.get("location")).toBe("http://localhost:3000/secretario?gmail=conectado");
  });

  it("a pessoa recusou no Google", async () => {
    const { GET } = await import("@/app/api/gmail/retorno/route");
    const r = await GET(new Request("http://localhost:3000/api/gmail/retorno?error=access_denied&state=estado-certo"));
    expect(r.headers.get("location")).toBe("http://localhost:3000/casa?gmail=recusado");
  });
});
