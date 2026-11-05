import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Budget, Goal, Recurrence, Transaction } from "@/domain/types";

/**
 * Home Assistant.
 *
 * O que guarda: o resumo usa as regras do Inicio (gasto, previsto, ritmo) e
 * nao leva lancamento, loja nem e-mail; as contas tem os dias contados na
 * hora; a energia projeta o mes pelo ritmo e compara com o mes passado; o
 * YAML poe o codigo no secrets.yaml; e as rotas so respondem com codigo
 * valido, sem nunca mandar o codigo cru ao banco.
 */

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}));

const { montarResumoHA, energiaDoMes, respostaParaHA, configuracaoHA } = await import("@/domain/home-assistant");
const { codigoDoPedido, hashDoCodigo, novoCodigoHA } = await import("@/lib/ha-codigo");

let n = 0;
const tx = (p: Partial<Transaction>): Transaction =>
  ({
    id: `t${++n}`, houseId: "c", invoiceId: null, cardId: null, memberId: null, isJoint: false,
    date: "2026-11-02", invoiceMonth: "2026-11", description: "MERCADO SECRETO", merchantOriginal: "MERCADO SECRETO",
    merchantNormalized: "MERCADO SECRETO", merchantAlias: null, amount: 100, currency: "BRL", originalAmount: null,
    originalCurrency: null, type: "expense", origin: "invoice", status: "confirmed", categoryId: "mer",
    subcategoryId: null, note: null, receiptUrl: null, visibility: "shared", splitType: "none",
    splitPercentage: null, installment: null, recurringId: null, reconciledWithId: null, calendarEventId: null,
    eventLinkDecided: false, isHidden: false, isReconciled: false, createdBy: null, createdAt: "", updatedAt: "",
    ...p,
  }) as Transaction;

const AGORA = new Date(2026, 10, 10, 12); // 10/11/2026

describe("o resumo", () => {
  const transacoes = [
    ...["2026-08", "2026-09", "2026-10"].map((m) => tx({ invoiceMonth: m as Transaction["invoiceMonth"], date: `${m}-05`, amount: 3000 })),
    tx({ amount: 1200 }),
    tx({ type: "income", amount: 9000, categoryId: null }),
  ];
  const recorrentes = [
    { id: "r1", houseId: "c", description: "Condomínio", merchant: null, amount: 850, categoryId: null, cardId: null, ownerId: null, interval: "monthly", nextDate: "2026-11-15", expectedDay: 15, isActive: true, offCard: true, source: "manual" },
    { id: "r2", houseId: "c", description: "Seguro anual", merchant: null, amount: 2000, categoryId: null, cardId: null, ownerId: null, interval: "yearly", nextDate: "2027-03-01", expectedDay: 1, isActive: true, offCard: true, source: "manual" },
  ] as Recurrence[];
  const orcamentos = [{ id: "b", houseId: "c", categoryId: "mer", month: "2026-11", limitAmount: 1000 }] as Budget[];
  const metas = [{ id: "g", houseId: "c", name: "Viagem", targetAmount: 10000, currentAmount: 2500, targetDate: null, monthlyContribution: null, ownerId: null, note: null, status: "active" }] as Goal[];

  const resumo = montarResumoHA({
    mes: "2026-11",
    transacoes,
    recorrentes,
    orcamentos,
    metas,
    categorias: [{ id: "mer", name: "Mercado" }],
    contasDoEmail: [
      { resumo: "Boleto da escola", amountCents: 120_000, dueDate: "2026-11-12" },
      { resumo: "Venceu ontem", amountCents: 1_000, dueDate: "2026-11-09" },
    ],
    agora: AGORA,
  });

  it("gasto, receitas e previsto com as regras do Início", () => {
    expect(resumo.gastoCents).toBe(120_000);
    expect(resumo.receitasCents).toBe(900_000);
    expect(resumo.previstoCents).toBeGreaterThan(0);
    expect(resumo.pctPrevisto).toBe(Math.round((120_000 / resumo.previstoCents!) * 100));
    expect(resumo.situacao).toBe("no ritmo");
  });

  it("orçamentos e metas em números; contas: só as que vêm, nos próximos 15 dias", () => {
    expect(resumo.orcamentos).toEqual([{ categoria: "Mercado", limiteCents: 100_000, gastoCents: 120_000, pct: 120 }]);
    expect(resumo.metas).toEqual([{ nome: "Viagem", atualCents: 250_000, alvoCents: 1_000_000, pct: 25 }]);
    expect(resumo.contas.map((c) => c.descricao)).toEqual(["Boleto da escola", "Condomínio"]);
  });

  it("nada de loja nem de lançamento no que vai para o Home Assistant", () => {
    expect(JSON.stringify(resumo)).not.toMatch(/MERCADO SECRETO/);
  });

  it("a resposta conta os dias na hora e resume a próxima conta", () => {
    const r = respostaParaHA({ resumo, resumoEm: "2026-11-10T11:00:00Z", tarifaKwh: null, energia: [] }, AGORA);
    expect(r.gasto).toBe(1200);
    expect(r.contas[0]).toMatchObject({ descricao: "Boleto da escola", valor: 1200, dias: 2 });
    expect(r.proxima_conta).toMatch(/^Boleto da escola · R\$\s1\.200,00 · em 2 dias$/);
    // O boleto (2 dias) e o condominio (dia 15, 5 dias); o seguro de marco fica de fora.
    expect(r.contas_7_dias).toBe(2);
    expect(r.orcamentos_estourados).toBe(1);
    expect(r.energia).toBeNull();
  });

  it("próxima conta cabe no estado de um sensor (255 caracteres)", () => {
    const longo = { ...resumo, contas: [{ descricao: "x".repeat(400), valorCents: 100, vencimento: "2026-11-12" as const }] };
    const r = respostaParaHA({ resumo: longo, resumoEm: null, tarifaKwh: null, energia: [] }, AGORA);
    expect(r.proxima_conta!.length).toBeLessThanOrEqual(255);
  });

  it("sem resumo gravado ainda: valores nulos, sem quebrar", () => {
    const r = respostaParaHA({ resumo: null, resumoEm: null, tarifaKwh: null, energia: [] }, AGORA);
    expect(r).toMatchObject({ gasto: null, situacao: "sem dados", contas: [], proxima_conta: null });
  });
});

describe("energia", () => {
  const leituras = [
    { dia: "2026-10-31" as const, kwhMes: 300 },
    { dia: "2026-11-09" as const, kwhMes: 80 },
    { dia: "2026-11-10" as const, kwhMes: 120 },
  ];

  it("projeta o mês pelo ritmo, compara com o passado e estima o custo", () => {
    const e = energiaDoMes(leituras, AGORA, 0.95)!;
    expect(e).toMatchObject({ mes: "2026-11", dia: "2026-11-10", kwhMes: 120, projecaoKwh: 360, mesPassadoKwh: 300 });
    expect(e.custoEstimadoCents).toBe(34_200);
  });

  it("no primeiro dia não projeta; sem leitura do mês, nada", () => {
    expect(energiaDoMes([{ dia: "2026-11-01", kwhMes: 9 }], new Date(2026, 10, 1, 12), 1)!.projecaoKwh).toBeNull();
    expect(energiaDoMes([{ dia: "2026-10-31", kwhMes: 300 }], AGORA, null)).toBeNull();
  });
});

describe("a configuração do Home Assistant", () => {
  it("o código vai no secrets.yaml; o configuration.yaml só o referencia", () => {
    const { segredo, configuracao } = configuracaoHA("https://fluxo.app/", "fluxo_abc");
    expect(segredo).toBe('fluxo_auth: "Bearer fluxo_abc"');
    expect(configuracao).not.toMatch(/fluxo_abc/);
    expect(configuracao).toMatch(/Authorization: !secret fluxo_auth/);
    for (const rota of ["/api/ha/resumo", "/api/ha/tarefas", "/api/ha/tarefas/concluir", "/api/ha/energia"]) {
      expect(configuracao).toContain(`https://fluxo.app${rota}`);
    }
    // Chave propria: nao briga com o `automation: !include` da casa.
    expect(configuracao).toMatch(/^automation fluxo:$/m);
    // Medidor indisponivel nao manda 0 (apagaria a leitura do dia).
    expect(configuracao).toContain("states('sensor.energia_mes') | is_number");
  });

  it("sem o código (já foi mostrado), a linha do segredo fica com o lugar dele", () => {
    expect(configuracaoHA("https://fluxo.app", null).segredo).toMatch(/COLE_AQUI_O_CODIGO/);
  });
});

describe("o código", () => {
  it("aleatório, no formato, e o banco só vê o sha256", () => {
    const a = novoCodigoHA();
    expect(a).toMatch(/^fluxo_[A-Za-z0-9_-]{43}$/);
    expect(novoCodigoHA()).not.toBe(a);
    expect(hashDoCodigo(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("só aceita Bearer com código no formato", () => {
    const pedido = (h?: string) => new Request("https://x/api/ha/resumo", { headers: h ? { authorization: h } : {} });
    const codigo = novoCodigoHA();
    expect(codigoDoPedido(pedido(`Bearer ${codigo}`))).toBe(codigo);
    expect(codigoDoPedido(pedido())).toBeNull();
    expect(codigoDoPedido(pedido("Bearer qualquer"))).toBeNull();
    expect(codigoDoPedido(pedido(codigo))).toBeNull();
  });
});

describe("as rotas", () => {
  const codigo = novoCodigoHA();
  const com = (url: string, init: RequestInit = {}) =>
    new Request(url, { ...init, headers: { authorization: `Bearer ${codigo}`, "content-type": "application/json" } });

  beforeEach(() => rpc.mockReset());

  it("sem código: 401, e o banco nem é chamado", async () => {
    const { GET } = await import("@/app/api/ha/resumo/route");
    const r = await GET(new Request("https://x/api/ha/resumo"));
    expect(r.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("código que o banco não conhece: 401 com o que fazer", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "28000", message: "Código inválido." } });
    const { GET } = await import("@/app/api/ha/resumo/route");
    const r = await GET(com("https://x/api/ha/resumo"));
    expect(r.status).toBe(401);
    expect((await r.json()).error).toMatch(/Gere outro/);
    // O banco recebe o hash, nunca o codigo.
    expect(rpc).toHaveBeenCalledWith("ha_ler_resumo", { p_hash: hashDoCodigo(codigo) });
  });

  it("migração ainda não aplicada: 503", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const { GET } = await import("@/app/api/ha/tarefas/route");
    expect((await GET(com("https://x/api/ha/tarefas"))).status).toBe(503);
  });

  it("tarefas: lista com total; nova tarefa exige título", async () => {
    rpc.mockResolvedValue({ data: [{ id: "t1", titulo: "Trocar o filtro", coluna: "A fazer", prazo: null }], error: null });
    const rota = await import("@/app/api/ha/tarefas/route");
    const lista = await rota.GET(com("https://x/api/ha/tarefas"));
    expect(await lista.json()).toEqual({ total: 1, tarefas: [{ id: "t1", titulo: "Trocar o filtro", coluna: "A fazer", prazo: null }] });

    const vazio = await rota.POST(com("https://x/api/ha/tarefas", { method: "POST", body: JSON.stringify({ titulo: "  " }) }));
    expect(vazio.status).toBe(400);

    rpc.mockResolvedValue({ data: "t2", error: null });
    const nova = await rota.POST(com("https://x/api/ha/tarefas", { method: "POST", body: JSON.stringify({ titulo: "Comprar lâmpada" }) }));
    expect(nova.status).toBe(201);
    expect(rpc).toHaveBeenLastCalledWith("ha_tarefa_criar", { p_hash: hashDoCodigo(codigo), p_titulo: "Comprar lâmpada" });
  });

  it("concluir: tarefa de outra casa ou já feita dá 404", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const { POST } = await import("@/app/api/ha/tarefas/concluir/route");
    const r = await POST(com("https://x/api/ha/tarefas/concluir", { method: "POST", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000001" }) }));
    expect(r.status).toBe(404);
  });

  it("energia: aceita o número como texto (o template do Home Assistant manda assim)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { POST } = await import("@/app/api/ha/energia/route");
    const r = await POST(com("https://x/api/ha/energia", { method: "POST", body: JSON.stringify({ kwh: "123.4", dia: "2026-11-03" }) }));
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("ha_registrar_energia", { p_hash: hashDoCodigo(codigo), p_dia: "2026-11-03", p_kwh: 123.4 });
    const ruim = await POST(com("https://x/api/ha/energia", { method: "POST", body: JSON.stringify({ kwh: -1 }) }));
    expect(ruim.status).toBe(400);
  });
});
