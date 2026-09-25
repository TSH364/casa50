import { describe, expect, it, vi } from "vitest";
import { belongsToMember, summarizeMonth } from "@/domain/finance";
import { DOS_DOIS, transactionSchema } from "@/domain/schemas";
import type { Transaction } from "@/domain/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({}));
const { memberOrFilter } = await import("@/data/queries");

/**
 * O filtro por pessoa.
 *
 * O que guarda: "Todos" mostra tudo; cada pessoa ve o que marcou, o que e
 * dos dois (com o valor cheio) e o que ninguem marcou no cartao dela; e a
 * regra do banco (o filtro `or`) diz exatamente o mesmo que a do dominio - a
 * lista vem de um, o total do outro.
 */

const VINI = "11111111-1111-4111-8111-111111111111";
const LARI = "22222222-2222-4222-8222-222222222222";
const CARTAO_VINI = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARTAO_SEM_DONO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    houseId: "casa",
    invoiceId: null,
    cardId: null,
    memberId: null,
    isJoint: false,
    date: "2026-09-10",
    invoiceMonth: "2026-09",
    description: "x",
    merchantOriginal: null,
    merchantNormalized: null,
    merchantAlias: null,
    amount: 100,
    currency: "BRL",
    originalAmount: null,
    originalCurrency: null,
    type: "expense",
    origin: "invoice",
    status: "confirmed",
    categoryId: null,
    subcategoryId: null,
    note: null,
    receiptUrl: null,
    visibility: "shared",
    splitType: "none",
    splitPercentage: null,
    installment: null,
    recurringId: null,
    reconciledWithId: null,
    calendarEventId: null,
    eventLinkDecided: false,
    isHidden: false,
    isReconciled: false,
    createdBy: null,
    createdAt: "",
    updatedAt: "",
    ...p,
  };
}

const MES = [
  tx({ memberId: VINI, amount: 10 }),
  tx({ memberId: LARI, amount: 20 }),
  tx({ isJoint: true, amount: 40 }),
  // Fatura sem pessoa, no cartao do Vini: e dele.
  tx({ cardId: CARTAO_VINI, cardOwnerId: VINI, amount: 80 }),
  // Marcado com a Larissa no cartao do Vini: a marcacao vence o cartao.
  tx({ cardId: CARTAO_VINI, cardOwnerId: VINI, memberId: LARI, amount: 160 }),
  // Sem pessoa e cartao sem dono: so em Todos.
  tx({ cardId: CARTAO_SEM_DONO, cardOwnerId: null, amount: 320 }),
];

const gasto = (memberId: string | null) =>
  summarizeMonth(MES, "2026-09", { memberId }).spentCents / 100;

describe("belongsToMember e os totais", () => {
  it("Todos soma tudo", () => {
    expect(gasto(null)).toBe(630);
  });

  it("cada um: o marcado, o dos dois (cheio) e o sem pessoa no próprio cartão", () => {
    expect(gasto(VINI)).toBe(10 + 40 + 80);
    expect(gasto(LARI)).toBe(20 + 40 + 160);
  });

  it("os três filtros não mostram mais a mesma coisa", () => {
    expect(new Set([gasto(null), gasto(VINI), gasto(LARI)]).size).toBe(3);
  });

  it("marcação vence o dono do cartão", () => {
    const t = MES[4]!;
    expect(belongsToMember(t, LARI)).toBe(true);
    expect(belongsToMember(t, VINI)).toBe(false);
  });
});

describe("memberOrFilter — a mesma regra, no banco", () => {
  const donos = new Map<string, string | null>([
    [CARTAO_VINI, VINI],
    [CARTAO_SEM_DONO, null],
  ]);

  it("dos dois, marcado, ou sem pessoa num cartão dela", () => {
    expect(memberOrFilter(VINI, donos)).toBe(
      `is_joint.is.true,member_id.eq.${VINI},and(member_id.is.null,card_id.in.(${CARTAO_VINI}))`,
    );
  });

  it("sem cartão próprio, só dos dois e marcado", () => {
    expect(memberOrFilter(LARI, donos)).toBe(`is_joint.is.true,member_id.eq.${LARI}`);
  });

  it("id que não é uuid não vira texto dentro do filtro", () => {
    // Vem da URL: sem esta trava, `?membro=x,is_joint.is.false` reescreveria o `or`.
    expect(memberOrFilter("x),or(house_id.neq.0", donos)).toBeNull();
  });

  /**
   * Equivalencia: avalia o filtro gerado como o PostgREST avaliaria, sobre as
   * mesmas linhas, e compara com o dominio. Se uma das regras mudar sozinha,
   * a lista e o total ao lado dela deixam de bater - e este teste pega.
   */
  it("dá a mesma resposta que o domínio, linha a linha", () => {
    for (const pessoa of [VINI, LARI]) {
      const filtro = memberOrFilter(pessoa, donos)!;
      const cartoes = /card_id\.in\.\(([^)]*)\)/.exec(filtro)?.[1]?.split(",") ?? [];
      const peloBanco = (t: Transaction) =>
        t.isJoint ||
        t.memberId === pessoa ||
        (t.memberId === null && t.cardId !== null && cartoes.includes(t.cardId));
      for (const t of MES) expect(peloBanco(t)).toBe(belongsToMember(t, pessoa));
    }
  });
});

describe("\"Os dois\" no formulário", () => {
  const BASE = {
    description: "Jantar",
    date: "2026-09-10",
    invoiceMonth: "2026-09",
    amount: "120,00",
    type: "expense",
    categoryId: "",
    cardId: "",
    visibility: "shared",
    splitType: "none",
    note: "",
    merchantAlias: "",
    installmentCurrent: "",
    installmentTotal: "",
  };

  it("aceita", () => {
    const r = transactionSchema.safeParse({ ...BASE, memberId: DOS_DOIS });
    expect(r.success && r.data.memberId).toBe(DOS_DOIS);
  });

  it("gasto dos dois não pode ser individual", () => {
    const r = transactionSchema.safeParse({ ...BASE, memberId: DOS_DOIS, visibility: "individual" });
    expect(r.success).toBe(false);
  });

  it("qualquer outro texto continua recusado", () => {
    expect(transactionSchema.safeParse({ ...BASE, memberId: "os dois" }).success).toBe(false);
  });
});
