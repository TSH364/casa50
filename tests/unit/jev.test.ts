import { describe, expect, it } from "vitest";
import {
  NENHUMA,
  buildQuestions,
  categoryCriteria,
  importAsks,
  medianCents,
  merchantState,
  readPick,
  readVerdict,
  subcategoryCriteria,
  weekdayShare,
} from "@/domain/jev";
import type { CategoryOption, JevCategories, MerchantAsk } from "@/domain/jev";

/**
 * O que vai ao Jev e como a resposta vira decisao.
 *
 * O que guarda: que as opcoes levam o significado e os exemplos da casa; que
 * a situacao nao leva nada que identifique a casa; que so passa palpite acima
 * do corte; e que a subcategoria so vale sob a categoria que ficou.
 */

const ALIMENTACAO: CategoryOption = {
  id: "cat-ali",
  name: "Alimentação",
  canonical: "Alimentacao",
  examples: ["OBA HORTIFRUTI", "SUPER CITY"],
};
const TRANSPORTE: CategoryOption = {
  id: "cat-tra",
  name: "Transporte",
  canonical: "Transporte",
  examples: ["TUPINAMBAENER"],
};
const TSH: CategoryOption = {
  id: "cat-tsh",
  name: "TSH",
  canonical: null,
  examples: ["MERCADOLIVRE", "AMAZON BR", "LEROY MERLIN"],
};
const TRABALHO: CategoryOption = { id: "sub-trab", name: "Trabalho", canonical: null, examples: ["SUBITO RICE"] };
const FDS: CategoryOption = { id: "sub-fds", name: "Fim de semana", canonical: null, examples: ["PADARIA NOVA GLORIA"] };
const UBER: CategoryOption = { id: "sub-uber", name: "Uber", canonical: null, examples: ["UBER UBER TRIP"] };

const CATS: JevCategories = {
  parents: [ALIMENTACAO, TRANSPORTE, TSH],
  subsByParent: new Map([
    ["cat-ali", [TRABALHO, FDS]],
    ["cat-tra", [UBER]],
  ]),
  nameById: new Map([
    ["cat-ali", "Alimentação"],
    ["cat-tra", "Transporte"],
    ["cat-tsh", "TSH"],
  ]),
};

const EVIDENCIA = {
  label: "UBERRIDES",
  count: 5,
  medianCents: 2_350,
  weekdayShare: 0.8,
  bankHint: "Serviços",
};

describe("opções", () => {
  it("chave legível e sem acento; descrição com significado e exemplos da casa", () => {
    const { criteria, idByKey } = categoryCriteria([ALIMENTACAO, TSH]);
    expect(Object.keys(criteria)).toEqual(["alimentacao", "tsh"]);
    expect(idByKey.get("alimentacao")).toBe("cat-ali");
    expect(criteria.alimentacao).toMatch(/restaurante/);
    expect(criteria.alimentacao).toMatch(/OBA HORTIFRUTI/);
    // Categoria que nao e das iniciais: o que a explica sao os exemplos.
    expect(criteria.tsh).toBe("TSH — na casa: MERCADOLIVRE, AMAZON BR, LEROY MERLIN");
  });

  it("nomes que dariam a mesma chave não colidem", () => {
    const { idByKey } = categoryCriteria([
      { ...TSH, id: "a", name: "Casa" },
      { ...TSH, id: "b", name: "casa!" },
    ]);
    expect([...idByKey]).toEqual([
      ["casa", "a"],
      ["casa_2", "b"],
    ]);
  });

  it("subcategoria sempre tem a saída 'nenhuma'", () => {
    const { criteria, idByKey } = subcategoryCriteria("Alimentação", [TRABALHO, FDS]);
    expect(criteria[NENHUMA]).toMatch(/fica só em Alimentação/);
    expect(idByKey.has(NENHUMA)).toBe(false);
  });

  it("uma subcategoria chamada 'Nenhuma' não sequestra a saída", () => {
    const { criteria, idByKey } = subcategoryCriteria("X", [{ ...TRABALHO, name: "Nenhuma" }]);
    expect(idByKey.get("nenhuma_")).toBe("sub-trab");
    expect(criteria[NENHUMA]).toMatch(/Nenhuma destas/);
  });
});

describe("situação", () => {
  it("leva a loja e os números — e diz que a dica do banco é fraca", () => {
    const s = merchantState(EVIDENCIA);
    expect(s).toMatch(/UBERRIDES/);
    expect(s).toMatch(/5 compras/);
    expect(s).toMatch(/80% das compras em dia útil/);
    expect(s).toMatch(/costuma errar/);
  });

  it("uma compra só não inventa padrão de dia da semana", () => {
    const s = merchantState({ ...EVIDENCIA, count: 1, bankHint: null });
    expect(s).toMatch(/Uma compra de/);
    expect(s).not.toMatch(/dia útil/);
    expect(s).not.toMatch(/banco/);
  });

  it("mediana e dia útil", () => {
    expect(medianCents([100, 300, 200])).toBe(200);
    expect(medianCents([100, 200])).toBe(150);
    expect(medianCents([])).toBe(0);
    // 2026-09-21 e segunda; 2026-09-26 e sabado.
    expect(weekdayShare(["2026-09-21", "2026-09-26"])).toBe(0.5);
  });
});

describe("perguntas", () => {
  const semCategoria: MerchantAsk = { merchant: "UBERRIDES", evidence: EVIDENCIA, knownCategoryId: null };

  it("sem categoria: pergunta a categoria e a subcategoria de cada mãe que tem", () => {
    const built = buildQuestions(semCategoria, CATS)!;
    expect(Object.keys(built.questions)).toEqual(["categoria", "sub_1", "sub_2"]);
    expect([...built.subs.values()].map((s) => s.parentId)).toEqual(["cat-ali", "cat-tra"]);
  });

  it("com categoria conhecida: só a subcategoria dela", () => {
    const built = buildQuestions({ ...semCategoria, knownCategoryId: "cat-tra" }, CATS)!;
    expect(Object.keys(built.questions)).toEqual(["sub_1"]);
    expect(built.category).toBeNull();
  });

  it("categoria conhecida e sem subcategorias: nada a perguntar", () => {
    expect(buildQuestions({ ...semCategoria, knownCategoryId: "cat-tsh" }, CATS)).toBeNull();
  });
});

describe("leitura", () => {
  const ids = new Map([["transporte", "cat-tra"]]);

  it("só passa acima do corte", () => {
    const r = { choice: "transporte", probabilities: { transporte: 0.55 } };
    expect(readPick(r, ids, 0.6)).toBeNull();
    expect(readPick({ ...r, probabilities: { transporte: 0.9 } }, ids, 0.6)).toEqual({
      id: "cat-tra",
      probability: 0.9,
    });
  });

  it("chave que não foi perguntada não vira id", () => {
    expect(readPick({ choice: "inventada", probabilities: { inventada: 1 } }, ids, 0.1)).toBeNull();
  });

  it("'nenhuma' é resposta, não falha", () => {
    expect(readPick({ choice: NENHUMA, probabilities: { [NENHUMA]: 0.9 } }, ids, 0.5)).toEqual({
      id: null,
      probability: 0.9,
    });
  });

  it("subcategoria só vale sob a categoria que ficou", () => {
    const ask: MerchantAsk = { merchant: "UBERRIDES", evidence: EVIDENCIA, knownCategoryId: null };
    const built = buildQuestions(ask, CATS)!;
    const respostas = {
      categoria: { choice: "transporte", probabilities: { transporte: 0.92 } },
      // A de Alimentacao tambem veio, com certeza alta - e tem de ser ignorada.
      sub_1: { choice: "trabalho", probabilities: { trabalho: 0.99 } },
      sub_2: { choice: "uber", probabilities: { uber: 0.88 } },
    };
    expect(readVerdict(respostas, built, ask)).toEqual({
      categoryId: "cat-tra",
      categoryProbability: 0.92,
      subcategoryId: "sub-uber",
      subcategoryProbability: 0.88,
    });
  });

  it("categoria abaixo do corte leva a subcategoria junto", () => {
    const ask: MerchantAsk = { merchant: "X", evidence: EVIDENCIA, knownCategoryId: null };
    const built = buildQuestions(ask, CATS)!;
    const v = readVerdict(
      {
        categoria: { choice: "transporte", probabilities: { transporte: 0.4 } },
        sub_2: { choice: "uber", probabilities: { uber: 0.99 } },
      },
      built,
      ask,
    );
    expect(v).toEqual({
      categoryId: null,
      categoryProbability: null,
      subcategoryId: null,
      subcategoryProbability: null,
    });
  });
});

describe("importAsks", () => {
  const linha = (over: Partial<Parameters<typeof importAsks>[0][number]>) => ({
    merchantNormalized: "LOJA",
    merchantOriginal: "LOJA*1",
    description: "LOJA*1",
    amountCents: 1_000,
    date: "2026-09-21",
    categoryHint: null,
    categoryId: null,
    weak: true,
    ruleDecidesSubcategory: false,
    ...over,
  });

  it("uma pergunta por loja, a mais frequente primeiro", () => {
    const asks = importAsks(
      [linha({ merchantNormalized: "A" }), linha({ merchantNormalized: "B" }), linha({ merchantNormalized: "B" })],
      CATS.subsByParent,
    );
    expect(asks.map((a) => [a.merchant, a.evidence.count])).toEqual([
      ["B", 2],
      ["A", 1],
    ]);
  });

  it("fonte fraca pergunta a categoria, e leva a dica do banco como pista", () => {
    const [ask] = importAsks([linha({ categoryHint: "Serviços", categoryId: "cat-tsh" })], CATS.subsByParent);
    expect(ask?.knownCategoryId).toBeNull();
    expect(ask?.evidence.bankHint).toBe("Serviços");
  });

  it("categoria firme: só vai se ela tem subcategorias e nenhuma regra decide", () => {
    const firme = { weak: false, categoryId: "cat-tra" };
    expect(importAsks([linha(firme)], CATS.subsByParent)[0]?.knownCategoryId).toBe("cat-tra");
    expect(importAsks([linha({ ...firme, categoryId: "cat-tsh" })], CATS.subsByParent)).toEqual([]);
    expect(importAsks([linha({ ...firme, ruleDecidesSubcategory: true })], CATS.subsByParent)).toEqual([]);
  });
});
