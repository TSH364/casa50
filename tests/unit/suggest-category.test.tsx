import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * A categoria sugerida ao digitar a descricao de um lancamento manual.
 *
 * O que guarda: regra da casa resolve sem sair para a rede; so o que a regra
 * nao resolve vai ao Jev; e na tela, a regra preenche sozinha e o palpite do
 * Jev so entra com o toque em "Usar" - e nunca ao editar um lancamento.
 */

const ALI = "00000000-0000-4000-8000-000000000001";
const TRA = "00000000-0000-4000-8000-000000000002";
const UBER = "00000000-0000-4000-8000-000000000012";

function tabela(nome: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "range", "is", "in"]) b[m] = () => b;
  b.then = (ok: (r: unknown) => unknown) =>
    Promise.resolve({
      data:
        nome === "categories"
          ? [
              { id: ALI, name: "Alimentacao", parent_id: null },
              { id: TRA, name: "Transporte", parent_id: null },
              { id: UBER, name: "Uber", parent_id: TRA },
            ]
          : nome === "learned_rules"
            ? [{ normalized_pattern: "PADARIA DA ESQUINA", category_id: ALI, subcategory_id: null }]
            : [],
      error: null,
    }).then(ok);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => "sk-or-da-casa" }));
vi.mock("@/lib/houses", () => ({ listMembers: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "u" }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));

const { suggestCategoryFromText } = await import("@/actions/jev");

describe("suggestCategoryFromText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("regra da casa resolve, e nada sai para a rede", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await suggestCategoryFromText({ description: "Padaria da esquina" })).toMatchObject({
      categoryId: ALI,
      via: "regra",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loja conhecida pela tabela também, sem Jev", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await suggestCategoryFromText({ description: "Posto Ipiranga" })).toMatchObject({
      categoryId: TRA,
      via: "loja",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("o resto vai ao Jev, com o valor digitado", async () => {
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        const corpo = JSON.parse(String(init.body));
        corpos.push(corpo);
        const answers: Record<string, unknown> = {};
        for (const [nome, q] of Object.entries(corpo.questions as Record<string, { criteria: Record<string, string> }>)) {
          const escolha = nome === "categoria" ? "transporte" : Object.keys(q.criteria).includes("uber") ? "uber" : "nenhuma";
          answers[nome] = { choice: escolha, probabilities: { [escolha]: 0.91 } };
        }
        return new Response(JSON.stringify({ answers }), { status: 200 });
      }),
    );
    const r = await suggestCategoryFromText({ description: "Corrida pro aeroporto", amountCents: 6_540 });
    expect(r).toEqual({ categoryId: TRA, subcategoryId: UBER, via: "jev", probability: 0.91 });
    expect(String(corpos[0]!.state)).toMatch(/Corrida pro aeroporto/);
    expect(String(corpos[0]!.state)).toMatch(/65,40/);
  });
});

// ---------------------------------------------------------------------------

describe("formulário", () => {
  let resposta: Record<string, unknown> = {};
  beforeEach(() => {
    resposta = {};
    vi.resetModules();
    vi.doMock("@/actions/jev", () => ({ suggestCategoryFromText: async () => resposta }));
    vi.doMock("@/actions/transactions", () => ({
      createTransaction: async () => ({}),
      updateTransaction: async () => ({}),
    }));
    vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
  });

  const CATS = [
    { id: ALI, houseId: "c", name: "Alimentacao", color: "#f00", icon: null, parentId: null, isActive: true, excludedFromTotals: false },
    { id: TRA, houseId: "c", name: "Transporte", color: "#00f", icon: null, parentId: null, isActive: true, excludedFromTotals: false },
    { id: UBER, houseId: "c", name: "Uber", color: "#00f", icon: null, parentId: TRA, isActive: true, excludedFromTotals: false },
  ];

  async function abrir(transaction?: Record<string, unknown>) {
    const { TransactionFormDialog } = await import("@/components/transactions/transaction-form");
    render(
      <TransactionFormDialog
        open
        onOpenChange={() => {}}
        categories={CATS}
        cards={[]}
        members={[]}
        defaultMonth="2026-09"
        transaction={transaction as never}
      />,
    );
    const campo = screen.getByLabelText("Descrição");
    fireEvent.change(campo, { target: { value: "Corrida pro aeroporto" } });
    fireEvent.blur(campo);
  }

  it("palpite do Jev espera o toque em Usar", async () => {
    resposta = { categoryId: TRA, subcategoryId: UBER, via: "jev", probability: 0.91 };
    await abrir();
    const usar = await screen.findByRole("button", { name: /Usar Transporte › Uber/ });
    expect((screen.getByLabelText("Categoria") as HTMLSelectElement).value).toBe("");
    fireEvent.click(usar);
    await waitFor(() => expect((screen.getByLabelText("Categoria") as HTMLSelectElement).value).toBe(TRA));
    expect((screen.getByLabelText("Subcategoria") as HTMLSelectElement).value).toBe(UBER);
  });

  it("regra da casa preenche sozinha, e diz de onde veio", async () => {
    resposta = { categoryId: ALI, subcategoryId: null, via: "regra" };
    await abrir();
    await screen.findByText("Pela regra da casa.");
    expect((screen.getByLabelText("Categoria") as HTMLSelectElement).value).toBe(ALI);
  });

  it("ao editar um lançamento, não sugere nada", async () => {
    resposta = { categoryId: TRA, subcategoryId: UBER, via: "jev", probability: 0.91 };
    await abrir({
      id: "t1", description: "x", amount: 10, type: "expense", date: "2026-09-10", invoiceMonth: "2026-09",
      categoryId: null, subcategoryId: null, memberId: null, isJoint: false, cardId: null,
      visibility: "shared", note: null, merchantAlias: null, installment: null,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: /Usar/ })).toBeNull();
  });
});
