import { describe, expect, it, vi } from "vitest";
import { DOS_DOIS } from "@/domain/schemas";

/**
 * "Os dois" gravado: `is_joint` ligado e `member_id` nulo - a combinacao
 * que a constraint do banco exige. Uma pessoa: o contrario.
 */

const gravados: Record<string, unknown>[] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/shared", async (original) => ({
  ...(await original<typeof import("@/actions/shared")>()),
  requireHouseId: async () => "casa-1",
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        gravados.push(row);
        return { error: null };
      },
    }),
  }),
}));

const { createTransaction } = await import("@/actions/transactions");

function formulario(memberId: string) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    description: "Jantar",
    date: "2026-09-10",
    invoiceMonth: "2026-09",
    amount: "120,00",
    type: "expense",
    categoryId: "",
    subcategoryId: "",
    memberId,
    cardId: "",
    visibility: "shared",
    splitType: "none",
    note: "",
    merchantAlias: "",
    installmentCurrent: "",
    installmentTotal: "",
  })) {
    f.set(k, v);
  }
  return f;
}

describe("createTransaction", () => {
  it("\"Os dois\" grava is_joint e nenhuma pessoa", async () => {
    gravados.length = 0;
    expect(await createTransaction({}, formulario(DOS_DOIS))).toEqual({ ok: true });
    expect(gravados[0]).toMatchObject({ member_id: null, is_joint: true });
  });

  it("uma pessoa grava a pessoa, e is_joint desligado", async () => {
    gravados.length = 0;
    const vini = "11111111-1111-4111-8111-111111111111";
    await createTransaction({}, formulario(vini));
    expect(gravados[0]).toMatchObject({ member_id: vini, is_joint: false });
  });

  it("não grava mais a divisão: o acerto saiu, e a coluna antiga fica como estava", async () => {
    gravados.length = 0;
    await createTransaction({}, formulario(DOS_DOIS));
    expect(gravados[0]).not.toHaveProperty("split_type");
  });
});
