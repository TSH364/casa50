import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Radar de produtos - cadastrar e conferir, com banco e busca falsos.
 *
 * O que guarda: cadastrar ja confere e grava o preco de hoje; so anuncio
 * conferido entra (a busca e pedida sem o plano C); sem chave de IA nada e
 * buscado e a reserva e solta; a abertura do app so confere o que conseguiu
 * reservar; e antes da migracao a tela recebe um aviso, nao um erro.
 */

type Chamada = { tabela: string; op: string; payload: unknown; filtros: string[] };

const estado = {
  chamadas: [] as Chamada[],
  semTabela: false,
  vencidos: [] as { id: string; name: string }[],
  reservaveis: new Set<string>(),
  chave: "sk-or-casa" as string | null,
  ofertas: [] as Record<string, unknown>[],
  buscas: [] as { produto: string; opcoes: Record<string, unknown> }[],
  usos: [] as { feature: string }[],
};

function tabela(nome: string) {
  const c: Chamada = { tabela: nome, op: "select", payload: null, filtros: [] };
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "or", "in", "order", "limit", "lt", "is"]) {
    b[m] = (campo: string, valor: unknown) => {
      c.filtros.push(`${m}:${campo}:${String(valor)}`);
      return b;
    };
  }
  for (const op of ["insert", "update", "delete"]) {
    b[op] = (p: unknown) => {
      c.op = op;
      c.payload = p;
      return b;
    };
  }
  b.select = () => b;
  const resultado = () => {
    estado.chamadas.push(c);
    if (estado.semTabela) return { data: null, error: { code: "PGRST205" } };
    if (nome === "radar_products" && c.op === "insert") return { data: { id: "00000000-0000-4000-8000-000000000001", name: (c.payload as { name: string }).name }, error: null };
    if (nome === "radar_products" && c.op === "select") return { data: estado.vencidos, error: null };
    if (nome === "radar_products" && c.op === "update" && (c.payload as Record<string, unknown>).check_started_at && !("last_checked_at" in (c.payload as object))) {
      const id = c.filtros.find((f) => f.startsWith("eq:id:"))?.slice(6) ?? "";
      return { data: estado.reservaveis.has(id) ? estado.vencidos.find((v) => v.id === id) ?? { id, name: "x" } : null, error: null };
    }
    return { data: null, error: null };
  };
  b.single = () => Promise.resolve(resultado());
  b.maybeSingle = () => Promise.resolve(resultado());
  b.then = (ok: (r: unknown) => unknown) => Promise.resolve(resultado()).then(ok);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "vini" }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => estado.chave }));
vi.mock("@/lib/ai-usage", () => ({ recordAiUsage: async (_h: string, feature: string) => void estado.usos.push({ feature }) }));
vi.mock("@/lib/imagem-produto", () => ({
  buscarImagemDoProduto: async (url: string) => (url.includes("amazon") ? null : "https://magalu.com/foto.jpg"),
}));
vi.mock("@/lib/ofertas", () => ({
  buscarOfertas: async (produto: string, _teto: unknown, opcoes: Record<string, unknown>) => {
    estado.buscas.push({ produto, opcoes });
    return { offers: estado.ofertas, costUsd: 0.007, model: "m", details: {} };
  },
}));

const { adicionarAoRadar, syncRadar } = await import("@/actions/radar");

const da = (tabela: string, op: string) => estado.chamadas.filter((c) => c.tabela === tabela && c.op === op);

beforeEach(() => {
  Object.assign(estado, {
    chamadas: [],
    semTabela: false,
    vencidos: [],
    reservaveis: new Set<string>(),
    chave: "sk-or-casa",
    ofertas: [
      { title: "Air fryer Mondial 4L", store: "Amazon", priceCents: 38_900, installments: null, url: "https://amazon.com.br/p", priceSeen: true },
      { title: "Air fryer Mondial 4L", store: "Magalu", priceCents: 41_000, installments: null, url: "https://magalu.com/p", priceSeen: true },
    ],
    buscas: [],
    usos: [],
  });
});

describe("cadastrar", () => {
  it("já confere: grava o preço de hoje e a melhor oferta no produto", async () => {
    const r = await adicionarAoRadar({ nome: "  Air fryer   Mondial 4L ", meta: "400" });
    expect(r).toEqual({ ok: true, achou: { cents: 38_900, loja: "Amazon" } });
    expect(da("radar_products", "insert")[0]!.payload).toMatchObject({ house_id: "casa-1", name: "Air fryer Mondial 4L", target_cents: 40_000 });
    // Só anúncio conferido: a busca vai sem o plano C.
    expect(estado.buscas[0]).toEqual({ produto: "Air fryer Mondial 4L", opcoes: expect.objectContaining({ aceitarNaoConferidas: false }) });
    expect(da("radar_prices", "insert")[0]!.payload).toMatchObject({ price_cents: 38_900, store: "Amazon", price_seen: true });
    const fechou = da("radar_products", "update")
      .map((c) => c.payload as Record<string, unknown>)
      .find((p) => "last_checked_at" in p)!;
    expect(fechou).toMatchObject({ check_started_at: null, best_cents: 38_900, best_store: "Amazon", last_error: null });
    expect(estado.usos).toEqual([{ feature: "radar" }]);
    // As outras lojas da busca, para comparar na tela.
    expect(da("radar_products", "update").map((c) => (c.payload as Record<string, unknown>).last_offers).find(Boolean)).toEqual([
      { loja: "Magalu", cents: 41_000, url: "https://magalu.com/p", vistoNaPagina: true },
    ]);
    // A Amazon bloqueou a pagina; a foto veio da segunda oferta.
    expect(da("radar_products", "update").some((c) => (c.payload as Record<string, unknown>).image_url === "https://magalu.com/foto.jpg")).toBe(true);
  });

  it("meta que não é valor e nome curto voltam como erro, sem gravar", async () => {
    expect((await adicionarAoRadar({ nome: "TV", meta: "" })).error).toMatch(/qual é o produto/);
    expect((await adicionarAoRadar({ nome: "Air fryer", meta: "barato" })).error).toMatch(/valor em reais/);
    expect(estado.chamadas).toHaveLength(0);
  });

  it("sem chave de IA: nada é buscado, e a reserva é solta com o motivo", async () => {
    estado.chave = null;
    const r = await adicionarAoRadar({ nome: "Air fryer Mondial 4L" });
    expect(r.error).toMatch(/chave de IA/);
    expect(estado.buscas).toHaveLength(0);
    expect(da("radar_products", "update").at(-1)!.payload).toMatchObject({ check_started_at: null, last_error: expect.stringMatching(/chave/) });
  });

  it("antes da migração: aviso de instalação, não erro genérico", async () => {
    estado.semTabela = true;
    expect((await adicionarAoRadar({ nome: "Air fryer Mondial 4L" })).error).toMatch(/sendo instalado/);
  });
});

describe("abrir o app", () => {
  it("só confere o que conseguiu reservar", async () => {
    estado.vencidos = [
      { id: "a", name: "Air fryer" },
      { id: "b", name: "Cadeira" },
    ];
    estado.reservaveis = new Set(["b"]);
    await syncRadar();
    expect(estado.buscas.map((b) => b.produto)).toEqual(["Cadeira"]);
  });

  it("antes da migração, não faz nada nem derruba a tela", async () => {
    estado.semTabela = true;
    await expect(syncRadar()).resolves.toBeUndefined();
    expect(estado.buscas).toHaveLength(0);
  });
});
