import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardState, ownerCriteria } from "@/domain/jev";

/**
 * O Jev sugerindo o dono de um cartao.
 *
 * O que guarda: os exemplos de cada pessoa saem do que ja e dela (marcado,
 * ou nos cartoes dela) e so as lojas exclusivas entram; o final do cartao nao
 * vai ao Jev; abaixo do corte nao ha sugestao; e sem referencia de alguem a
 * acao diz o que falta em vez de chutar.
 */

describe("ownerCriteria", () => {
  it("só as lojas que só aquela pessoa usa — as comuns não separam ninguém", () => {
    const { criteria } = ownerCriteria([
      { id: "v", firstName: "Vinicius", examples: ["SUBITO RICE", "MERCADOLIVRE", "OPENAI"] },
      { id: "l", firstName: "Larissa", examples: ["MERCADOLIVRE", "CONECTC LARISSAPAD"] },
    ]);
    expect(criteria.vinicius).toMatch(/SUBITO RICE, OPENAI/);
    expect(criteria.vinicius).not.toMatch(/MERCADOLIVRE/);
    expect(criteria.larissa).toMatch(/CONECTC LARISSAPAD/);
  });

  it("a situação lista lojas e contagem, sem final de cartão", () => {
    const s = cardState([{ label: "KINDLE SVCS", count: 14 }]);
    expect(s).toMatch(/KINDLE SVCS \(14x\)/);
    expect(s).not.toMatch(/\d{4}/);
  });
});

// ---------------------------------------------------------------------------

const VINI = "11111111-1111-4111-8111-111111111111";
const LARI = "22222222-2222-4222-8222-222222222222";
const SEM_DONO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DA_LARI = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const estado = {
  lancamentos: [] as { card_id: string | null; member_id: string | null; merchant_normalized: string }[],
  resposta: { choice: "larissa", p: 0.84 },
  corpos: [] as Record<string, unknown>[],
};

function tabela(nome: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "range"]) b[m] = () => b;
  b.then = (ok: (r: unknown) => unknown) =>
    Promise.resolve({
      data:
        nome === "cards"
          ? [{ id: SEM_DONO, owner_id: null }, { id: DA_LARI, owner_id: LARI }]
          : estado.lancamentos,
      error: null,
    }).then(ok);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", () => ({ requireHouseId: async () => "casa-1" }));
vi.mock("@/lib/ai-config", () => ({ getAiKey: async () => "sk-or-da-casa" }));
vi.mock("@/lib/houses", () => ({
  listMembers: async () => [
    { userId: VINI, fullName: "Vinicius Roselli", email: "", role: "owner" },
    { userId: LARI, fullName: "Larissa Souza", email: "", role: "member" },
  ],
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "u" }),
  createClient: async () => ({ from: (t: string) => tabela(t) }),
}));

const { suggestCardOwnerWithJev } = await import("@/actions/jev");

describe("suggestCardOwnerWithJev", () => {
  beforeEach(() => {
    estado.corpos = [];
    estado.resposta = { choice: "larissa", p: 0.84 };
    estado.lancamentos = [
      { card_id: SEM_DONO, member_id: null, merchant_normalized: "KINDLE SVCS" },
      { card_id: null, member_id: VINI, merchant_normalized: "SUBITO RICE" },
      // Sem pessoa, mas no cartao da Larissa: conta como dela.
      { card_id: DA_LARI, member_id: null, merchant_normalized: "DROGARIA" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        estado.corpos.push(JSON.parse(String(init.body)));
        const { choice, p } = estado.resposta;
        return new Response(JSON.stringify({ answers: { dono: { choice, probabilities: { [choice]: p } } } }), { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sugere, com a certeza — e o cartão da Larissa conta como referência dela", async () => {
    const r = await suggestCardOwnerWithJev({ cardId: SEM_DONO });
    expect(r).toEqual({ memberId: LARI, probability: 0.84 });
    const criterios = (estado.corpos[0]!.questions as { dono: { criteria: Record<string, string> } }).dono.criteria;
    expect(criterios.larissa).toMatch(/DROGARIA/);
    expect(String(estado.corpos[0]!.state)).toMatch(/KINDLE SVCS/);
  });

  it("abaixo de 70%: não sugere ninguém, mas diz a certeza", async () => {
    estado.resposta = { choice: "vinicius", p: 0.55 };
    expect(await suggestCardOwnerWithJev({ cardId: SEM_DONO })).toEqual({ memberId: null, probability: 0.55 });
  });

  it("sem referência de alguém: diz o que falta, e não pergunta", async () => {
    estado.lancamentos = estado.lancamentos.filter((t) => t.card_id !== DA_LARI);
    const r = await suggestCardOwnerWithJev({ cardId: SEM_DONO });
    expect(r.error).toMatch(/Falta referência de Larissa/);
    expect(estado.corpos).toHaveLength(0);
  });

  it("cartão de outra casa (ou inventado) não é encontrado", async () => {
    const r = await suggestCardOwnerWithJev({ cardId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    expect(r.error).toMatch(/não encontrado/);
  });
});
