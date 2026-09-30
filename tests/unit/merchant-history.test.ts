import { describe, expect, it } from "vitest";
import {
  confiancaDaRegraDoJev,
  historicoParaJev,
  montarHistorico,
  regrasDoJev,
} from "@/domain/merchant-history";

/**
 * Historico da loja e regra do Jev.
 *
 * O que guarda: o historico so decide loja que a casa SEMPRE pos no mesmo
 * lugar, duas vezes ou mais, e so com o que passou pela casa (palpite do Jev
 * e dica do banco nao contam - senao um erro se reforcaria sozinho); loja
 * que variou vira pista para o Jev; e so vira regra o palpite confirmado com
 * 85%+ em todas as linhas da loja, guardado com certeza < 1 para a correcao
 * da casa sempre vencer.
 */

describe("histórico da loja", () => {
  it("decide só a loja consistente, 2 vezes ou mais, com o que passou pela casa", () => {
    const h = montarHistorico([
      { merchant: "PETLOVE", categoryId: "saude", source: "casa" },
      { merchant: "PETLOVE", categoryId: "saude", source: null },
      { merchant: "STARLINK", categoryId: "assinaturas", source: "regra" },
      { merchant: "MERCADOLIVRE", categoryId: "tsh", source: "casa" },
      { merchant: "MERCADOLIVRE", categoryId: "tsh", source: "casa" },
      { merchant: "MERCADOLIVRE", categoryId: "tsh", source: "loja" },
      { merchant: "MERCADOLIVRE", categoryId: "casa", source: "casa" },
    ]);
    expect(h.consistente.get("PETLOVE")).toBe("saude");
    // Uma vez so ainda nao e historico.
    expect(h.consistente.has("STARLINK")).toBe(false);
    // Variou: nao decide, mas guarda as contagens para o Jev.
    expect(h.consistente.has("MERCADOLIVRE")).toBe(false);
    expect(h.porLoja.get("MERCADOLIVRE")).toEqual([
      { categoryId: "tsh", count: 3 },
      { categoryId: "casa", count: 1 },
    ]);
  });

  it("palpite do Jev e dica do banco não contam: o erro não se reforça", () => {
    const h = montarHistorico([
      { merchant: "PETLOVE", categoryId: "lazer", source: "jev" },
      { merchant: "PETLOVE", categoryId: "lazer", source: "jev" },
      { merchant: "PETLOVE", categoryId: "lazer", source: "banco" },
    ]);
    expect(h.consistente.has("PETLOVE")).toBe(false);
    expect(h.porLoja.has("PETLOVE")).toBe(false);
  });

  it("vira pista em texto para o Jev, só com nomes e contagens", () => {
    const nomes = new Map([
      ["tsh", "TSH"],
      ["casa", "Casa"],
    ]);
    expect(
      historicoParaJev(
        [
          { categoryId: "tsh", count: 3 },
          { categoryId: "casa", count: 1 },
        ],
        nomes,
      ),
    ).toBe("Na casa, esta loja já foi classificada como TSH (3 vezes) e Casa (1 vez).");
    expect(historicoParaJev(undefined, nomes)).toBeNull();
    // Categoria apagada nao entra.
    expect(historicoParaJev([{ categoryId: "sumiu", count: 2 }], nomes)).toBeNull();
  });
});

describe("regra do Jev", () => {
  const jev = (merchant: string, categoryId: string, p: number, decision = "new") => ({
    merchantNormalized: merchant,
    categoryId,
    categorySource: "jev" as const,
    jevProbability: p,
    decision,
  });

  it("só com 85%+ em todas as linhas da loja, na mesma categoria, e só das importadas", () => {
    const regras = regrasDoJev([
      jev("PETLOVE", "saude", 0.93),
      jev("PETLOVE", "saude", 0.88),
      jev("CLUBE LIVELO", "lazer", 0.66),
      jev("LOJA A", "casa", 0.9),
      jev("LOJA A", "lazer", 0.95),
      jev("LOJA B", "casa", 0.95, "ignored"),
      { merchantNormalized: "STARLINK", categoryId: "assinaturas", categorySource: "regra" as const, decision: "new" },
    ]);
    expect(regras).toEqual([{ pattern: "PETLOVE", categoryId: "saude", confidence: 0.88 }]);
  });

  it("a certeza da regra do Jev nunca chega a 1 (1 é a marca da casa)", () => {
    expect(confiancaDaRegraDoJev(1)).toBe(0.999);
    expect(confiancaDaRegraDoJev(0.8765)).toBe(0.877);
  });
});
