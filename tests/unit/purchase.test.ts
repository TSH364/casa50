import { describe, expect, it } from "vitest";
import {
  needsLedgerEntry,
  priceGap,
  priorityRank,
  purchaseFromTransaction,
  purchaseMonth,
  rankCandidates,
  type LinkableTransaction,
} from "@/domain/purchase";

/**
 * A compra da obra.
 *
 * Cada bloco aqui guarda um erro que o app cometeria com a resposta obvia, e o
 * comentario diz quanto dinheiro o erro custaria na base real de quem usa.
 */

function lancamento(partial: Partial<LinkableTransaction> = {}): LinkableTransaction {
  return {
    id: "t1",
    date: "2026-09-12",
    invoiceMonth: "2026-09",
    description: "COMPRA",
    merchant: null,
    amountCents: 10_000,
    installmentCurrent: null,
    installmentTotal: null,
    installmentValueCents: null,
    cardLabel: null,
    ...partial,
  };
}

describe("purchaseFromTransaction", () => {
  it("à vista, a compra vale o que a linha diz", () => {
    const r = purchaseFromTransaction(lancamento({ amountCents: 693_50 }));
    expect(r).toMatchObject({
      amountCents: 693_50,
      invoiceMonth: "2026-09",
      installment: null,
      inferredTotal: false,
    });
  });

  it("parcelado, a compra vale a SOMA das parcelas", () => {
    // O CASO QUE ORIGINA ESTE ARQUIVO: R$ 8.965,50 de porcelanato em 10x
    // aparece na fatura como uma linha de R$ 896,55. Gravar a linha deixaria o
    // item 10% comprado para sempre, e o total da obra apontaria nove mil
    // reais a menos do que a casa deve.
    const r = purchaseFromTransaction(
      lancamento({
        amountCents: 896_55,
        installmentCurrent: 3,
        installmentTotal: 10,
        installmentValueCents: 896_55,
      }),
    );
    expect(r.amountCents).toBe(8_965_50);
    expect(r.installment).toEqual({ current: 3, total: 10, perMonthCents: 896_55 });
    expect(r.inferredTotal).toBe(true);
  });

  it("a compra é do mês da PRIMEIRA parcela, não do mês desta linha", () => {
    // Vincular a parcela 3 de 10 e gravar setembro seria dizer que a casa
    // comprou em setembro, quando ela comprou em julho.
    const r = purchaseFromTransaction(
      lancamento({
        invoiceMonth: "2026-09",
        installmentCurrent: 3,
        installmentTotal: 10,
        installmentValueCents: 100_00,
      }),
    );
    expect(r.invoiceMonth).toBe("2026-07");
  });

  it("vira o ano para trás sem passar por Date", () => {
    const r = purchaseFromTransaction(
      lancamento({
        invoiceMonth: "2026-02",
        installmentCurrent: 5,
        installmentTotal: 12,
        installmentValueCents: 50_00,
      }),
    );
    expect(r.invoiceMonth).toBe("2025-10");
  });

  it("sem installment_value, o valor da linha serve de parcela", () => {
    // Parte das faturas nao traz o valor da parcela, so "3/10". A linha e a
    // mesma coisa vista de outro lugar.
    const r = purchaseFromTransaction(
      lancamento({
        amountCents: 200_00,
        installmentCurrent: 1,
        installmentTotal: 4,
        installmentValueCents: null,
      }),
    );
    expect(r.amountCents).toBe(800_00);
  });

  it("'1 de 1' não é parcelamento", () => {
    const r = purchaseFromTransaction(
      lancamento({ amountCents: 300_00, installmentCurrent: 1, installmentTotal: 1 }),
    );
    expect(r.amountCents).toBe(300_00);
    expect(r.installment).toBeNull();
  });
});

describe("needsLedgerEntry", () => {
  it("só o cartão dispensa o lançamento", () => {
    // A fatura ja traz o que passou no cartao; lancar de novo contaria a mesma
    // despesa duas vezes. Boleto, pix e dinheiro nao chegam por lugar nenhum.
    expect(needsLedgerEntry("card")).toBe(false);
    expect(needsLedgerEntry("boleto")).toBe(true);
    expect(needsLedgerEntry("pix")).toBe(true);
    expect(needsLedgerEntry("cash")).toBe(true);
  });
});

describe("priceGap", () => {
  it("diz quanto passou do previsto, e em que proporção", () => {
    expect(priceGap(8_965_50, 9_200_00)).toEqual({
      diffCents: 234_50,
      ratio: 234_50 / 8_965_50,
    });
  });

  it("negativo quando saiu mais barato", () => {
    expect(priceGap(1_000_00, 900_00)?.diffCents).toBe(-100_00);
  });

  it("cala quando não há previsto com que comparar", () => {
    // Zero previsto com valor pago nao e "infinito por cento a mais": e um
    // item que ninguem cotou, e uma porcentagem ali seria alarme sem conteudo.
    expect(priceGap(null, 500_00)).toBeNull();
    expect(priceGap(0, 500_00)).toBeNull();
  });
});

describe("rankCandidates", () => {
  const porcelanato = lancamento({
    id: "certo",
    merchant: "PORTINARI REVESTIMENTOS LTDA",
    amountCents: 8_965_50,
    date: "2026-08-02",
  });
  const mercado = lancamento({
    id: "mercado",
    merchant: "ASSAI ATACADISTA",
    amountCents: 312_40,
    date: "2026-09-10",
  });
  const tinta = lancamento({
    id: "tinta",
    merchant: "JK TINTAS E PISOS LTDA",
    amountCents: 330_65,
    date: "2026-09-01",
  });

  it("põe na frente quem casa fornecedor e valor", () => {
    const r = rankCandidates([mercado, tinta, porcelanato], {
      supplier: "Portinari",
      expectedCents: 8_965_50,
    });
    expect(r[0]?.transaction.id).toBe("certo");
  });

  it("casa o nome mesmo escrito diferente na fatura", () => {
    // A cotacao diz "JK Tintas e pisos"; a fatura escreve em caixa alta com
    // "LTDA" no fim. E a mesma chave que o resto do app usa para juntar os dois.
    const r = rankCandidates([mercado, tinta], { supplier: "JK Tintas e pisos" });
    expect(r[0]?.transaction.id).toBe("tinta");
    expect(r[0]!.score).toBeGreaterThan(0);
  });

  it("acha o parcelado pelo total da compra, e não pela parcela", () => {
    // Sem somar as parcelas, um item previsto em R$ 8.965 nunca casaria com a
    // linha de R$ 896,55 - e todo parcelamento ficaria no fim da lista.
    const parcelado = lancamento({
      id: "parcelado",
      merchant: "LOJA",
      amountCents: 896_55,
      installmentCurrent: 2,
      installmentTotal: 10,
      installmentValueCents: 896_55,
    });
    const r = rankCandidates([mercado, parcelado], { expectedCents: 8_965_50 });
    expect(r[0]?.transaction.id).toBe("parcelado");
  });

  it("sem fornecedor nem valor, devolve tudo com o mais recente na frente", () => {
    const r = rankCandidates([porcelanato, mercado, tinta], {});
    expect(r.map((c) => c.transaction.id)).toEqual(["mercado", "tinta", "certo"]);
  });
});

describe("priorityRank", () => {
  it("sem prioridade vai depois de baixa", () => {
    // Por na frente o que ninguem pensou empurraria para baixo justamente o
    // que foi pensado.
    expect(priorityRank(1)).toBeLessThan(priorityRank(3));
    expect(priorityRank(3)).toBeLessThan(priorityRank(null));
  });
});

describe("purchaseMonth", () => {
  it("o mês gravado vence a data da compra", () => {
    // Boleto de obra se combina para o mes que vem: a data em que se comprou e
    // a data em que o dinheiro sai sao datas diferentes.
    expect(purchaseMonth({ invoiceMonth: "2026-10", date: "2026-09-17" })).toBe("2026-10");
    expect(purchaseMonth({ invoiceMonth: null, date: "2026-09-17" })).toBe("2026-09");
  });
});
