import { describe, expect, it, vi } from "vitest";

/**
 * `listTransactions` passa do teto de 1.000 linhas do PostgREST.
 *
 * O falso abaixo corta cada resposta em 1.000, como o Supabase faz. Antes da
 * paginacao, pedir 3.000 devolvia 1.000 - e os meses mais antigos sumiam das
 * medias do Inicio sem erro nenhum.
 */

const TOTAL = 2_345;
const pedidos: [number, number][] = [];

function linha(i: number) {
  return {
    id: `t${String(i).padStart(5, "0")}`, house_id: "casa", invoice_id: null, card_id: null,
    member_id: null, is_joint: false, date: "2026-09-01", invoice_month: "2026-09-01",
    description: "x", merchant_original: null, merchant_normalized: null, merchant_alias: null,
    amount: 1, currency: "BRL", original_amount: null, original_currency: null, type: "expense",
    origin: "invoice", status: "confirmed", category_id: null, subcategory_id: null, note: null,
    receipt_url: null, visibility: "shared", split_type: "none", split_percentage: null,
    installment_current: null, installment_total: null, installment_value: null,
    calendar_event_id: null, event_link_decided: false, recurring_id: null, reconciled_with_id: null,
    is_hidden: false, is_reconciled: false, created_by: null, created_at: "", updated_at: "",
  };
}

function consulta(tabela: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte", "or", "is", "order"]) b[m] = () => b;
  b.range = (de: number, ate: number) => {
    pedidos.push([de, ate]);
    const fim = Math.min(ate + 1, de + 1000, TOTAL); // o teto do PostgREST
    const data = Array.from({ length: Math.max(0, fim - de) }, (_, k) => linha(de + k));
    return Promise.resolve({ data, error: null });
  };
  b.then = (ok: (r: unknown) => unknown) =>
    Promise.resolve({ data: tabela === "cards" ? [] : [], error: null }).then(ok);
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => consulta(t) }),
}));

const { listTransactions } = await import("@/data/queries");

describe("listTransactions em páginas", () => {
  it("traz tudo até o limite pedido, sem repetir linha", async () => {
    pedidos.length = 0;
    const r = await listTransactions("casa", { limit: 3000 });
    expect(r).toHaveLength(TOTAL);
    expect(new Set(r.map((t) => t.id)).size).toBe(TOTAL);
    // Parou quando a pagina veio incompleta, sem pedir uma quarta.
    expect(pedidos).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("respeita o limite menor que uma página", async () => {
    pedidos.length = 0;
    expect(await listTransactions("casa", { limit: 50 })).toHaveLength(50);
    expect(pedidos).toEqual([[0, 49]]);
  });
});
