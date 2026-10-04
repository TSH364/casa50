import { describe, expect, it } from "vitest";
import {
  diasDoCartao,
  inicioDaJanela,
  mesDaFatura,
  nomeDaConta,
  paraLancamento,
  precisaSincronizar,
  ultimosQuatro,
  type PluggyAccount,
  type PluggyTransaction,
} from "@/domain/pluggy";

/**
 * Meu Pluggy -> lancamento do app.
 *
 * O que guarda: so compra de cartao vira lancamento (conta corrente ainda nao:
 * traria o pagamento da fatura e transferencias, contando o mesmo dinheiro
 * duas vezes); pendente e pagamento da fatura ficam de fora; estorno e
 * estorno; a compra cai na fatura certa pelo fechamento; e a mesma compra tem
 * sempre a mesma identidade.
 */

const cartao: PluggyAccount = {
  id: "conta-1",
  type: "CREDIT",
  subtype: "CREDIT_CARD",
  name: "Nubank",
  marketingName: "Nubank Ultravioleta",
  number: "2150",
  creditData: { balanceCloseDate: "2026-10-03", balanceDueDate: "2026-10-10" },
};
const corrente: PluggyAccount = { id: "conta-2", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta Itaú", number: "12345-6" };

function tx(extra: Partial<PluggyTransaction> = {}): PluggyTransaction {
  return {
    id: "tx-1",
    description: "PADARIA DO ZE",
    amount: 39.9,
    date: "2026-09-15T00:00:00.000Z",
    type: "DEBIT",
    status: "POSTED",
    ...extra,
  };
}

const semDias = { closingDay: null, dueDay: null };

describe("compra do cartão vira lançamento", () => {
  it("compra: despesa, com a identidade da Pluggy e o final do cartão", () => {
    expect(paraLancamento(tx(), cartao, semDias)).toEqual({
      externalId: "pluggy:tx-1",
      date: "2026-09-15",
      invoiceMonth: "2026-09",
      description: "PADARIA DO ZE",
      merchantOriginal: "PADARIA DO ZE",
      merchantNormalized: "PADARIA DO ZE",
      amountCents: 3_990,
      type: "expense",
      cardLastFour: "2150",
      installmentCurrent: null,
      installmentTotal: null,
    });
  });

  it("o nome da loja vem do estabelecimento quando a Pluggy sabe; o cartão adicional pelo próprio final", () => {
    const l = paraLancamento(
      tx({ merchant: { businessName: "Ze Panificadora Ltda" }, creditCardMetadata: { cardNumber: "•••• 0162" } }),
      cartao,
      semDias,
    )!;
    expect(l.merchantNormalized).toBe("ZE PANIFICADORA LTDA");
    expect(l.cardLastFour).toBe("0162");
  });

  it("parcela: só quando o banco diz qual de quantas", () => {
    const l = paraLancamento(tx({ creditCardMetadata: { installmentNumber: 2, totalInstallments: 10 } }), cartao, semDias)!;
    expect([l.installmentCurrent, l.installmentTotal]).toEqual([2, 10]);
    const avista = paraLancamento(tx({ creditCardMetadata: { installmentNumber: 1, totalInstallments: 1 } }), cartao, semDias)!;
    expect([avista.installmentCurrent, avista.installmentTotal]).toEqual([null, null]);
  });

  it("crédito no cartão: estorno entra como estorno; pagamento da fatura não entra", () => {
    expect(paraLancamento(tx({ type: "CREDIT", description: "Estorno PADARIA" }), cartao, semDias)?.type).toBe("refund");
    expect(paraLancamento(tx({ type: "CREDIT", description: "Pagamento recebido" }), cartao, semDias)).toBeNull();
    expect(paraLancamento(tx({ type: "CREDIT", description: "Crédito", category: "Credit card payment" }), cartao, semDias)).toBeNull();
  });

  it("pendente, valor zero e conta corrente ficam de fora", () => {
    expect(paraLancamento(tx({ status: "PENDING" }), cartao, semDias)).toBeNull();
    expect(paraLancamento(tx({ amount: 0 }), cartao, semDias)).toBeNull();
    expect(paraLancamento(tx(), corrente, semDias)).toBeNull();
  });
});

describe("em que fatura cai", () => {
  it("sem fechamento: o mês da compra", () => {
    expect(mesDaFatura("2026-09-15", semDias)).toBe("2026-09");
  });

  it("fecha dia 3, vence dia 10: compra do dia 3 em diante vai para a fatura seguinte", () => {
    const c = { closingDay: 3, dueDay: 10 };
    expect(mesDaFatura("2026-09-02", c)).toBe("2026-09");
    expect(mesDaFatura("2026-09-03", c)).toBe("2026-10");
    expect(mesDaFatura("2026-12-20", c)).toBe("2027-01");
  });

  it("fecha 28, vence 5: a fatura vence no mês seguinte ao do fechamento", () => {
    const c = { closingDay: 28, dueDay: 5 };
    expect(mesDaFatura("2026-09-10", c)).toBe("2026-10");
    expect(mesDaFatura("2026-09-28", c)).toBe("2026-11");
  });

  it("fechamento e vencimento lidos da conta da Pluggy", () => {
    expect(diasDoCartao(cartao)).toEqual({ closingDay: 3, dueDay: 10 });
    expect(diasDoCartao(corrente)).toEqual({ closingDay: null, dueDay: null });
  });
});

describe("detalhes", () => {
  it("final do cartão em vários formatos", () => {
    expect(ultimosQuatro("2150")).toBe("2150");
    expect(ultimosQuatro("5162********2150")).toBe("2150");
    expect(ultimosQuatro("•••• 2150")).toBe("2150");
    expect(ultimosQuatro("abc")).toBeNull();
    expect(ultimosQuatro(null)).toBeNull();
  });

  it("o cartão criado leva o nome comercial da conta", () => {
    expect(nomeDaConta(cartao)).toBe("Nubank Ultravioleta");
    expect(nomeDaConta({ ...cartao, marketingName: null })).toBe("Nubank");
  });

  it("janela: primeira vez pega a fatura aberta e a anterior; depois, recua alguns dias", () => {
    const hoje = new Date("2026-10-04T12:00:00Z");
    expect(inicioDaJanela(null, hoje)).toBe("2026-08-20");
    expect(inicioDaJanela("2026-10-03T08:00:00Z", hoje)).toBe("2026-09-23");
  });

  it("abrir o app sincroniza de novo só depois de algumas horas", () => {
    const agora = new Date("2026-10-04T12:00:00Z");
    expect(precisaSincronizar(null, agora)).toBe(true);
    expect(precisaSincronizar("2026-10-04T09:00:00Z", agora)).toBe(false);
    expect(precisaSincronizar("2026-10-04T05:00:00Z", agora)).toBe(true);
  });
});
