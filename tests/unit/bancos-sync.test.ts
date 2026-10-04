import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sincronizacao com o Meu Pluggy, de ponta a ponta (API e banco falsos).
 *
 * O que guarda: a compra do cartao entra como provisoria (origem extrato,
 * sem fatura, com a identidade da Pluggy); cartao novo nasce com o nome da
 * conta e o dono da conexao; a mesma compra nao entra duas vezes - nem pela
 * identidade, nem quando ja esta no app pela fatura; credencial recusada nao
 * e guardada; e a abertura do app so le o que conseguiu reservar.
 */

const ALI = "00000000-0000-4000-8000-000000000003";
const VINI = "00000000-0000-4000-8000-0000000000b1";
const CONEXAO = "00000000-0000-4000-8000-0000000000c1";

type Chamada = { tabela: string; operacao: string; payload: unknown; filtros: [string, unknown][]; colunas: string };

const estado = {
  chamadas: [] as Chamada[],
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  conexoes: [] as Record<string, unknown>[],
  reservadas: [] as string[],
  cartoes: [] as Record<string, unknown>[],
  jaSincronizadas: [] as string[],
  existentes: [] as Record<string, unknown>[],
  pluggy: {
    authOk: true,
    contas: [] as Record<string, unknown>[],
    transacoes: [] as Record<string, unknown>[],
  },
};

type Resultado = { data: unknown; error: { code: string } | null };

function tabela(nome: string) {
  const chamada: Chamada = { tabela: nome, operacao: "select", payload: null, filtros: [], colunas: "" };
  const resolver = (): Resultado => {
    estado.chamadas.push(chamada);
    const { operacao, payload } = chamada;
    if (operacao === "insert" && nome === "cards") {
      const p = payload as { last_four: string };
      return { data: { id: `cartao-${p.last_four}` }, error: null };
    }
    if (operacao !== "select") return { data: null, error: null };
    if (nome === "cards") return { data: estado.cartoes, error: null };
    if (nome === "categories") return { data: [{ id: ALI, name: "Alimentacao", parent_id: null }], error: null };
    if (nome === "learned_rules") {
      return { data: [{ normalized_pattern: "PADARIA DO ZE", category_id: ALI, subcategory_id: null }], error: null };
    }
    if (nome === "transactions" && chamada.colunas === "external_id") {
      return { data: estado.jaSincronizadas.map((external_id) => ({ external_id })), error: null };
    }
    if (nome === "transactions" && chamada.filtros.some(([f]) => f === "is:external_id")) {
      return { data: estado.existentes, error: null };
    }
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "gte", "lte", "order", "range", "limit", "single", "maybeSingle"]) {
    b[m] = (campo: string, valor: unknown) => {
      chamada.filtros.push([`${m}:${campo}`, valor]);
      return b;
    };
  }
  b.select = (c?: string) => {
    if (chamada.operacao === "select") chamada.colunas = c ?? "";
    return b;
  };
  for (const op of ["insert", "update", "upsert", "delete"]) {
    b[op] = (p: unknown) => {
      chamada.operacao = op;
      chamada.payload = p;
      return b;
    };
  }
  b.then = (ok: (r: Resultado) => unknown) => Promise.resolve(resolver()).then(ok);
  return b;
}

async function rpc(nome: string, args: Record<string, unknown>): Promise<Resultado> {
  estado.rpcs.push({ nome, args });
  if (nome === "bank_connection_secrets") return { data: estado.conexoes, error: null };
  if (nome === "claim_bank_sync") return { data: estado.reservadas, error: null };
  return { data: "…cret", error: null };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: VINI }),
  createClient: async () => ({ from: (t: string) => tabela(t), rpc }),
}));

const { sincronizarBancos, syncStaleBanks, salvarConexaoBancaria } = await import("@/actions/bancos");

const pedidos: string[] = [];

beforeEach(() => {
  estado.chamadas.length = 0;
  estado.rpcs.length = 0;
  estado.conexoes = [
    { id: CONEXAO, member_id: VINI, client_id: "cliente-123", client_secret: "segredo-123", item_ids: ["item-nubank"], last_sync_at: null },
  ];
  estado.reservadas = [];
  estado.cartoes = [];
  estado.jaSincronizadas = [];
  estado.existentes = [];
  estado.pluggy = {
    authOk: true,
    contas: [
      { id: "conta-1", type: "CREDIT", subtype: "CREDIT_CARD", name: "Nubank", marketingName: "Nubank Ultravioleta", number: "2150", creditData: { balanceCloseDate: "2026-10-03", balanceDueDate: "2026-10-10" } },
      { id: "conta-2", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta", number: "1234" },
    ],
    transacoes: [
      { id: "tx-padaria", description: "PADARIA DO ZE", amount: 39.9, date: "2026-09-20T00:00:00Z", type: "DEBIT", status: "POSTED" },
      { id: "tx-posto", description: "POSTO SHELL", amount: 250, date: "2026-09-21T00:00:00Z", type: "DEBIT", status: "POSTED" },
      { id: "tx-pagamento", description: "Pagamento recebido", amount: 1000, date: "2026-09-10T00:00:00Z", type: "CREDIT", status: "POSTED" },
    ],
  };
  pedidos.length = 0;
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const caminho = String(url).replace("https://api.pluggy.ai", "");
    pedidos.push(`${init?.method ?? "GET"} ${caminho.split("?")[0]}`);
    if (caminho === "/auth") {
      return estado.pluggy.authOk
        ? new Response(JSON.stringify({ apiKey: "chave-2h" }), { status: 200 })
        : new Response("{}", { status: 401 });
    }
    expect((init?.headers as Record<string, string>)["X-API-KEY"]).toBe("chave-2h");
    if (caminho.startsWith("/accounts")) return new Response(JSON.stringify({ results: estado.pluggy.contas }), { status: 200 });
    if (caminho.startsWith("/transactions")) {
      return new Response(JSON.stringify({ results: estado.pluggy.transacoes, totalPages: 1 }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
});

const inseridos = () =>
  estado.chamadas.filter((c) => c.tabela === "transactions" && c.operacao === "insert").flatMap((c) => c.payload as Record<string, unknown>[]);

describe("sincronizar", () => {
  it("compra do cartão entra provisória; cartão novo nasce com o nome da conta e o dono da conexão", async () => {
    const r = await sincronizarBancos({ forcar: true });
    expect(r).toEqual({ novos: 2, erros: [] });

    const [cartao] = estado.chamadas.filter((c) => c.tabela === "cards" && c.operacao === "insert");
    expect(cartao!.payload).toEqual({
      house_id: "casa-1",
      name: "Nubank Ultravioleta",
      last_four: "2150",
      owner_id: VINI,
      closing_day: 3,
      due_day: 10,
    });

    const [padaria, posto] = inseridos();
    expect(padaria).toMatchObject({
      card_id: "cartao-2150",
      origin: "imported_statement",
      status: "confirmed",
      external_id: "pluggy:tx-padaria",
      amount: 39.9,
      type: "expense",
      // Fecha dia 3: compra de 20/09 cai na fatura que vence em outubro.
      invoice_month: "2026-10-01",
      category_id: ALI,
      category_source: "regra",
    });
    expect(posto).toMatchObject({ external_id: "pluggy:tx-posto", category_id: null });
    // Insert em lote com colunas uniformes.
    expect(Object.keys(padaria!).sort()).toEqual(Object.keys(posto!).sort());
    // Conta corrente nem e consultada; pagamento da fatura nao entra.
    expect(pedidos.filter((p) => p.startsWith("GET /transactions"))).toHaveLength(1);
    expect(estado.rpcs).toContainEqual({ nome: "mark_bank_sync", args: { p_connection: CONEXAO, p_error: null } });
  });

  it("a mesma compra não entra duas vezes: nem pela identidade, nem quando já veio na fatura", async () => {
    estado.cartoes = [{ id: "cartao-nubank", last_four: "2150", closing_day: null, due_day: null }];
    estado.jaSincronizadas = ["pluggy:tx-padaria"];
    // O posto ja esta no app pela fatura importada (mesmo cartao, valor e dia).
    estado.existentes = [
      { id: "da-fatura", date: "2026-09-21", amount: 250, type: "expense", card_id: "cartao-nubank", description: "POSTO SHELL", merchant_alias: null, installment_current: null, installment_total: null },
    ];
    const r = await sincronizarBancos({ forcar: true });
    expect(r.novos).toBe(0);
    expect(inseridos()).toHaveLength(0);
    // Cartao existente: nada criado.
    expect(estado.chamadas.filter((c) => c.tabela === "cards" && c.operacao === "insert")).toHaveLength(0);
  });

  it("credencial recusada: nada entra e o motivo fica na conexão", async () => {
    estado.pluggy.authOk = false;
    const r = await sincronizarBancos({ forcar: true });
    expect(r.novos).toBe(0);
    expect(r.erros[0]).toMatch(/recusou as credenciais/);
    expect(estado.rpcs).toContainEqual({
      nome: "mark_bank_sync",
      args: { p_connection: CONEXAO, p_error: expect.stringMatching(/recusou/) },
    });
  });

  it("sem forçar, conexão sincronizada há pouco não é lida", async () => {
    estado.conexoes[0]!.last_sync_at = new Date().toISOString();
    expect(await sincronizarBancos()).toEqual({ emDia: true, novos: 0, erros: [] });
    expect(pedidos).toHaveLength(0);
  });
});

describe("abrir o app", () => {
  it("lê só as conexões que conseguiu reservar", async () => {
    estado.reservadas = [];
    await syncStaleBanks();
    expect(pedidos).toHaveLength(0);

    estado.reservadas = [CONEXAO];
    await syncStaleBanks();
    expect(pedidos[0]).toBe("POST /auth");
    expect(estado.rpcs.find((r) => r.nome === "claim_bank_sync")!.args).toEqual({ p_house: "casa-1", p_hours: 6 });
  });
});

describe("conectar", () => {
  it("testa antes de guardar: credencial recusada não é guardada", async () => {
    estado.pluggy.authOk = false;
    const r = await salvarConexaoBancaria({ clientId: "cliente-123", clientSecret: "segredo-novo-1", itemIds: "item-nubank" });
    expect(r.error).toMatch(/recusou as credenciais/);
    expect(estado.rpcs.some((x) => x.nome === "set_bank_connection")).toBe(false);
  });

  it("credencial boa: guarda e diz o que encontrou", async () => {
    const r = await salvarConexaoBancaria({
      clientId: "cliente-123",
      clientSecret: "segredo-novo-1",
      itemIds: "item-nubank\n item-nubank, item-itau",
    });
    expect(r.contas?.[0]).toEqual({ nome: "Nubank Ultravioleta", tipo: "cartao", final: "2150" });
    expect(estado.rpcs.find((x) => x.nome === "set_bank_connection")!.args).toEqual({
      p_house: "casa-1",
      p_client_id: "cliente-123",
      p_client_secret: "segredo-novo-1",
      p_item_ids: ["item-nubank", "item-itau"],
    });
  });
});
