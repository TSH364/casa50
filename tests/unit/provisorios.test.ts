import { describe, expect, it } from "vitest";
import {
  casarProvisorios,
  ehProvisorio,
  janelaDasLinhas,
  pontuar,
  type LinhaDaFatura,
  type Provisorio,
} from "@/domain/provisorios";

/**
 * Lancamentos provisorios e a conciliacao com a fatura.
 *
 * O que guarda: a compra lancada no mes (a mao, pela conversa) e a linha da
 * fatura que chega depois sao UMA compra so - sem isto ela conta duas vezes.
 * E o contrario: compra diferente nao pode ser engolida por engano (outro
 * cartao, outra parcela, valor diferente sem nada mais em comum).
 */

const CARTAO = "cartao-itau";

function linha(extra: Partial<LinhaDaFatura> = {}): LinhaDaFatura {
  return {
    chave: "k1",
    date: "2026-09-15",
    amountCents: 4_000,
    type: "expense",
    cardId: CARTAO,
    merchantNormalized: "PADARIA DO ZE LTDA",
    installmentCurrent: null,
    installmentTotal: null,
    ...extra,
  };
}

function prov(extra: Partial<Provisorio> = {}): Provisorio {
  return {
    id: "p1",
    date: "2026-09-15",
    amountCents: 4_000,
    type: "expense",
    cardId: null,
    texto: "padaria",
    installmentCurrent: null,
    installmentTotal: null,
    ...extra,
  };
}

describe("o que é provisório", () => {
  const base = { invoiceId: null, cardId: CARTAO, origin: "manual", status: "confirmed", isReconciled: false };

  it("lançado no cartão, fora de uma fatura, ainda não conciliado", () => {
    expect(ehProvisorio(base)).toBe(true);
    expect(ehProvisorio({ ...base, origin: "imported_statement" })).toBe(true);
  });

  it("Pix e dinheiro já são o registro final; o que veio da fatura também", () => {
    expect(ehProvisorio({ ...base, cardId: null })).toBe(false);
    expect(ehProvisorio({ ...base, invoiceId: "fatura", origin: "invoice" })).toBe(false);
    expect(ehProvisorio({ ...base, status: "cancelled", isReconciled: true })).toBe(false);
    expect(ehProvisorio({ ...base, origin: "recurrence" })).toBe(false);
  });
});

describe("a mesma compra", () => {
  it("mesmo valor, datas próximas: casa, mesmo sem cartão no lançamento da conversa", () => {
    expect(pontuar(linha(), prov())).not.toBeNull();
    expect(pontuar(linha({ date: "2026-09-18" }), prov())).not.toBeNull();
  });

  it("longe demais, outro cartão, outra parcela ou outro tipo: não casa", () => {
    expect(pontuar(linha({ date: "2026-09-19" }), prov())).toBeNull();
    expect(pontuar(linha(), prov({ cardId: "cartao-nubank" }))).toBeNull();
    expect(pontuar(linha({ installmentCurrent: 2, installmentTotal: 3 }), prov())).toBeNull();
    expect(pontuar(linha({ type: "refund" }), prov())).toBeNull();
  });

  it("valor arredondado ('gastei 40') só casa quando o nome também bate", () => {
    const fatura = linha({ amountCents: 3_990 });
    expect(pontuar(fatura, prov())).not.toBeNull();
    expect(pontuar(fatura, prov({ texto: "mercado" }))).toBeNull();
    // Diferenca grande nao e arredondamento.
    expect(pontuar(linha({ amountCents: 4_500 }), prov())).toBeNull();
  });

  it("valor exato basta, mesmo com nome diferente", () => {
    expect(pontuar(linha(), prov({ texto: "café da manhã" }))).not.toBeNull();
  });
});

describe("casar", () => {
  it("um para um: duas compras iguais no mesmo dia vão cada uma para a sua linha", () => {
    const linhas = [
      linha({ chave: "a", merchantNormalized: "IFOOD", amountCents: 1_200 }),
      linha({ chave: "b", merchantNormalized: "UBER TRIP", amountCents: 1_200 }),
    ];
    const provs = [
      prov({ id: "uber", texto: "uber", amountCents: 1_200 }),
      prov({ id: "ifood", texto: "ifood", amountCents: 1_200 }),
    ];
    const r = casarProvisorios(linhas, provs);
    expect(r.get("a")?.id).toBe("ifood");
    expect(r.get("b")?.id).toBe("uber");
  });

  it("sobra provisório quando a fatura não trouxe a compra (ainda)", () => {
    const r = casarProvisorios([linha()], [prov(), prov({ id: "p2", date: "2026-09-16" })]);
    expect(r.size).toBe(1);
    expect(r.get("k1")?.id).toBe("p1");
  });

  it("janela de busca: das datas das linhas, com a folga dos dois lados", () => {
    expect(janelaDasLinhas(["2026-09-10", "2026-09-02", "2026-09-30"])).toEqual({
      de: "2026-08-30",
      ate: "2026-10-03",
    });
    expect(janelaDasLinhas([])).toBeNull();
  });
});
