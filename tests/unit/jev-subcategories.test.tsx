import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * O Jev separando o que ja foi importado: a acao e a tela.
 *
 * O que guarda: a casa e conferida antes de gastar a chave; so vai
 * proposta, nada e gravado ao sugerir; a tela pre-marca so o que tem 80% ou
 * mais; e ao aplicar, subcategoria de outra arvore e recusada.
 */

const ALI = "00000000-0000-4000-8000-000000000001";
const TRAB = "00000000-0000-4000-8000-000000000011";
const FDS = "00000000-0000-4000-8000-000000000012";
const UBER = "00000000-0000-4000-8000-000000000013";
const TRA = "00000000-0000-4000-8000-000000000002";

const estado = {
  casa: true,
  chave: "sk-or-da-casa" as string | null,
  escritas: [] as { tabela: string; op: string; payload?: unknown; filtros: unknown[] }[],
};

const CATEGORIAS = [
  { id: ALI, name: "Alimentacao", parent_id: null },
  { id: TRA, name: "Transporte", parent_id: null },
  { id: TRAB, name: "Trabalho", parent_id: ALI },
  { id: FDS, name: "Fim de semana", parent_id: ALI },
  { id: UBER, name: "Uber", parent_id: TRA },
];

const SEM_SUB = [
  ...Array.from({ length: 4 }, () => ({
    merchant_normalized: "SHOKITI",
    merchant_original: "SHOKITI",
    description: "SHOKITI",
    amount: 43,
    date: "2026-09-22",
  })),
  {
    merchant_normalized: "OBA HORTIFRUTI",
    merchant_original: "OBA HORTIFRUTI",
    description: "OBA",
    amount: 180,
    date: "2026-09-26",
  },
];

function tabela(nome: string) {
  let op = "select";
  let colunas = "";
  let payload: unknown;
  const filtros: unknown[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["order", "range", "limit"]) b[m] = () => b;
  for (const m of ["eq", "is", "in"]) {
    b[m] = (...args: unknown[]) => {
      filtros.push([m, ...args]);
      return b;
    };
  }
  b.select = (c?: string) => {
    if (op === "select") colunas = c ?? "";
    return b;
  };
  b.update = (p: unknown) => {
    op = "update";
    payload = p;
    return b;
  };
  b.upsert = (p: unknown) => {
    op = "upsert";
    payload = p;
    return b;
  };
  b.then = (ok: (r: unknown) => unknown) => {
    if (op !== "select") estado.escritas.push({ tabela: nome, op, payload, filtros });
    let data: unknown = [];
    if (nome === "categories") {
      // A conferencia do aplicar filtra por parent_id; o resto quer tudo.
      const pai = filtros.find((f) => (f as unknown[])[1] === "parent_id") as unknown[] | undefined;
      data = pai ? CATEGORIAS.filter((c) => c.parent_id === pai[2]) : CATEGORIAS;
    } else if (nome === "transactions" && op === "select" && colunas.includes("merchant_original")) {
      data = SEM_SUB;
    } else if (nome === "transactions" && op === "update") {
      data = [{ id: "t1" }, { id: "t2" }];
    }
    return Promise.resolve({ data, error: null }).then(ok);
  };
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({
  requireHouseId: async () => {
    if (!estado.casa) throw new Error("Nenhuma casa ativa.");
    return "casa-1";
  },
}));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => estado.chave }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));

const { suggestSubcategoriesWithJev, applyJevSubcategories } = await import("@/actions/jev");

function jev(respostas: Record<string, [string, number]>) {
  return vi.fn(async (_u: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body));
    const loja = Object.keys(respostas).find((l) => String(corpo.state).includes(l)) ?? "";
    const [escolha, p] = respostas[loja] ?? ["nenhuma", 0.9];
    return new Response(
      JSON.stringify({ answers: { sub_1: { choice: escolha, probabilities: { [escolha]: p } } } }),
      { status: 200 },
    );
  });
}

describe("suggestSubcategoriesWithJev", () => {
  beforeEach(() => {
    estado.casa = true;
    estado.chave = "sk-or-da-casa";
    estado.escritas = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("propõe por loja, com os números — e não grava nada", async () => {
    vi.stubGlobal("fetch", jev({ SHOKITI: ["trabalho", 0.93], OBA: ["nenhuma", 0.8] }));
    const r = await suggestSubcategoriesWithJev({ categoryId: ALI });
    expect(r.suggestions).toEqual([
      expect.objectContaining({
        merchant: "SHOKITI",
        count: 4,
        medianCents: 4_300,
        subcategoryId: TRAB,
        subcategoryName: "Trabalho",
        probability: 0.93,
      }),
    ]);
    expect(estado.escritas).toEqual([]);
  });

  it("palpite fraco demais nem aparece", async () => {
    vi.stubGlobal("fetch", jev({ SHOKITI: ["trabalho", 0.4] }));
    const r = await suggestSubcategoriesWithJev({ categoryId: ALI });
    expect(r.suggestions).toEqual([]);
  });

  it("sem casa, recusa antes de chamar a IA", async () => {
    estado.casa = false;
    const fetch = jev({});
    vi.stubGlobal("fetch", fetch);
    await expect(suggestSubcategoriesWithJev({ categoryId: ALI })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sem chave, diz onde configurar", async () => {
    estado.chave = null;
    const r = await suggestSubcategoriesWithJev({ categoryId: ALI });
    expect(r.error).toMatch(/tela da Casa/);
  });
});

describe("applyJevSubcategories", () => {
  beforeEach(() => {
    estado.escritas = [];
  });

  it("marca só quem está sem subcategoria, e guarda a regra", async () => {
    const r = await applyJevSubcategories({
      categoryId: ALI,
      items: [{ merchant: "SHOKITI", subcategoryId: TRAB }],
    });
    expect(r).toEqual({ ok: true, count: 2 });
    const [update, regra] = estado.escritas;
    expect(update).toMatchObject({ tabela: "transactions", op: "update", payload: { subcategory_id: TRAB } });
    expect(update?.filtros).toContainEqual(["is", "subcategory_id", null]);
    expect(regra).toMatchObject({
      tabela: "learned_rules",
      payload: [expect.objectContaining({ pattern: "SHOKITI", category_id: ALI, subcategory_id: TRAB })],
    });
  });

  it("subcategoria de outra categoria é recusada, e nada é escrito", async () => {
    const r = await applyJevSubcategories({
      categoryId: ALI,
      items: [{ merchant: "SHOKITI", subcategoryId: UBER }],
    });
    expect(r.error).toMatch(/não encontrada/);
    expect(estado.escritas).toEqual([]);
  });
});

describe("JevSubcategories (tela)", () => {
  it("pré-marca só o que tem 80% ou mais, e aplica só o marcado", async () => {
    const aplicados: unknown[] = [];
    vi.doMock("@/actions/jev", () => ({
      suggestSubcategoriesWithJev: async () => ({
        suggestions: [
          { merchant: "SHOKITI", label: "SHOKITI", count: 4, medianCents: 4300, weekdayShare: 1, subcategoryId: TRAB, subcategoryName: "Trabalho", probability: 0.93 },
          { merchant: "ZIG", label: "ZIG BELELEU", count: 2, medianCents: 9000, weekdayShare: 0, subcategoryId: FDS, subcategoryName: "Fim de semana", probability: 0.62 },
        ],
      }),
      applyJevSubcategories: async (input: unknown) => {
        aplicados.push(input);
        return { ok: true, count: 4 };
      },
    }));
    vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
    vi.resetModules();
    const { JevSubcategories } = await import("@/components/categories/jev-subcategories");

    render(<JevSubcategories rows={[{ id: ALI, name: "Alimentação", color: "#f00", pending: 341 }]} />);
    expect(screen.getByText(/341 lançamento/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sugerir/ }));

    const caixas = (await screen.findAllByRole("checkbox")) as HTMLInputElement[];
    expect(caixas.map((c) => c.checked)).toEqual([true, false]);
    expect(screen.getByText("62%")).toBeTruthy();

    const aplicar = screen.getByRole("button", { name: "Aplicar 1" }) as HTMLButtonElement;
    await waitFor(() => expect(aplicar.disabled).toBe(false));
    fireEvent.click(aplicar);
    await waitFor(() => expect(aplicados).toHaveLength(1));
    expect(aplicados[0]).toEqual({ categoryId: ALI, items: [{ merchant: "SHOKITI", subcategoryId: TRAB }] });
  });

  it("sem nada pendente, a tela nem aparece", async () => {
    const { JevSubcategories } = await import("@/components/categories/jev-subcategories");
    const { container } = render(<JevSubcategories rows={[{ id: ALI, name: "A", color: "#f00", pending: 0 }]} />);
    expect(container.textContent).toBe("");
  });
});
