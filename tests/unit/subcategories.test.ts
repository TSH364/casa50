import { describe, expect, it } from "vitest";
import { suggestSubcategories } from "@/domain/subcategories";
import type { Transaction } from "@/domain/types";

let n = 0;
function tx(overrides: Partial<Transaction> & { date: string }): Transaction {
  n += 1;
  return {
    id: `t${n}`,
    houseId: "casa",
    invoiceId: null,
    cardId: null,
    memberId: null,
    invoiceMonth: overrides.date.slice(0, 7),
    description: "COMPRA",
    merchantOriginal: null,
    merchantNormalized: "COMPRA",
    merchantAlias: null,
    amount: 40,
    currency: "BRL",
    originalAmount: null,
    originalCurrency: null,
    type: "expense",
    origin: "invoice",
    status: "confirmed",
    categoryId: "alimentacao",
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
    createdAt: "2026-08-10T00:00:00Z",
    updatedAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

/** Datas de segunda a sexta em meses distintos. */
const UTEIS = [
  "2026-06-01", "2026-06-09", "2026-06-17", "2026-06-25",
  "2026-07-02", "2026-07-10", "2026-07-20", "2026-07-28",
  "2026-08-05", "2026-08-13", "2026-08-21", "2026-08-27",
];
/** Sábados e domingos em meses distintos. */
const FDS = [
  "2026-06-06", "2026-06-14", "2026-06-20", "2026-06-28",
  "2026-07-04", "2026-07-12", "2026-07-19", "2026-07-26",
];

/**
 * Um estabelecimento onde a casa gastou, nas datas dadas.
 *
 * O valor VARIA em torno do informado, de propósito. A versão anterior deste
 * ajudante repetia o mesmo valor em todas as visitas, e isso não é o que um
 * extrato real mostra: MEDIDO nos 584 lançamentos importados, o restaurante
 * mais frequentado tem 11 valores distintos em 14 visitas, e o mais constante
 * de todos - uma confeitaria - ainda tem 4 valores em 10. Valor sempre igual é
 * a assinatura do faturamento de uma máquina, não de uma escolha, e o motor
 * passou a usar isso como sinal. Fixture com valor fixo fingia ser assinatura.
 */
function loja(merchant: string, datas: string[], valor: number) {
  return datas.map((d, i) =>
    tx({
      date: d,
      merchantNormalized: merchant,
      // Centavos diferentes por visita: varia sem mudar a ordem de grandeza,
      // então as asserções de mediana continuam valendo.
      amount: Math.round((valor + (i % 5) * 0.37) * 100) / 100,
    }),
  );
}

describe("suggestSubcategories — o caso real do Vinicius", () => {
  it("junta o almoço de trabalho e os cafés numa rotina de dia útil", () => {
    const sugestoes = suggestSubcategories([
      ...loja("SUBITO RICE", UTEIS, 43.52),
      ...loja("SHOKITI", UTEIS.slice(0, 7), 38.13),
      // O café: mesmo padrão de dia, ticket muito menor. O usuário disse que
      // toma junto do almoço, e o agrupamento tem de refletir isso.
      ...loja("ISABELA AKKARI DOCES", UTEIS.slice(0, 10), 13.09),
    ]);

    const rotina = sugestoes.find((s) => s.key === "rotina");
    expect(rotina).toBeDefined();
    expect(rotina!.merchants.map((m) => m.merchant).sort()).toEqual([
      "ISABELA AKKARI DOCES",
      "SHOKITI",
      "SUBITO RICE",
    ]);
    expect(rotina!.weekdayShare).toBe(1);
  });

  it("hortifruti é mercado pelo NOME, não vira refeição de fim de semana", () => {
    // A correção humana que o dado sozinho não daria: o ticket alto e os dias
    // mistos do hortifruti o jogariam em "fim de semana".
    const sugestoes = suggestSubcategories([
      // Datas espalhadas por três meses: uma proposta tirada de um mês só não
      // deve existir, e a amostra do teste precisa respeitar isso.
      ...loja(
        "OBA HORTIFRUTI GRANJA",
        ["2026-06-03", "2026-06-13", "2026-07-08", "2026-07-18", "2026-08-05", "2026-08-15"],
        120,
      ),
      ...loja("ASSAI ATACADISTA", ["2026-06-20", "2026-07-25", "2026-08-22"], 210),
    ]);

    const mercado = sugestoes.find((s) => s.key === "mercado");
    expect(mercado).toBeDefined();
    expect(mercado!.merchants.map((m) => m.merchant).sort()).toEqual([
      "ASSAI ATACADISTA",
      "OBA HORTIFRUTI GRANJA",
    ]);
    expect(sugestoes.find((s) => s.key === "fim_de_semana")).toBeUndefined();
  });

  it("restaurante de fim de semana vira o próprio grupo", () => {
    const sugestoes = suggestSubcategories([
      ...loja("CANTINA DO PORTO", FDS, 95),
    ]);
    expect(sugestoes.find((s) => s.key === "fim_de_semana")).toBeDefined();
  });
});

describe("suggestSubcategories — silêncio sem evidência", () => {
  it("não sugere a partir de um mês só", () => {
    const sugestoes = suggestSubcategories(
      loja("SUBITO RICE", ["2026-08-03", "2026-08-05", "2026-08-07", "2026-08-11",
        "2026-08-13", "2026-08-17", "2026-08-19"], 43),
    );
    expect(sugestoes).toEqual([]);
  });

  it("estabelecimento visto duas vezes não entra", () => {
    const sugestoes = suggestSubcategories([
      ...loja("SUBITO RICE", UTEIS, 43),
      ...loja("RARO", ["2026-06-02", "2026-07-02"], 30),
    ]);
    const rotina = sugestoes.find((s) => s.key === "rotina");
    expect(rotina!.merchants.map((m) => m.merchant)).not.toContain("RARO");
  });

  it("não mexe no que já tem subcategoria", () => {
    const sugestoes = suggestSubcategories(
      loja("SUBITO RICE", UTEIS, 43).map((t) => ({ ...t, subcategoryId: "ja-decidido" })),
    );
    expect(sugestoes).toEqual([]);
  });

  it("ignora oculto e pagamento de fatura", () => {
    const sugestoes = suggestSubcategories([
      ...loja("SUBITO RICE", UTEIS, 43).map((t) => ({ ...t, isHidden: true })),
      ...loja("PAGAMENTO", UTEIS, 900).map((t) => ({ ...t, type: "payment" as const })),
    ]);
    expect(sugestoes).toEqual([]);
  });

  it("cada proposta carrega a evidência que a sustenta", () => {
    const sugestoes = suggestSubcategories([
      ...loja("SUBITO RICE", UTEIS, 43.52),
      ...loja("SHOKITI", UTEIS.slice(0, 7), 38.13),
    ]);
    const rotina = sugestoes[0]!;
    expect(rotina.count).toBe(19);
    expect(rotina.monthsSeen).toBe(3);
    expect(rotina.totalCents).toBeGreaterThan(0);
    expect(rotina.medianCents).toBeGreaterThan(0);
  });
});

describe("nome de mercado — as armadilhas do radical", () => {
  const meses = ["2026-06-03", "2026-07-08", "2026-08-05"];
  function so(merchant: string) {
    return suggestSubcategories(loja(merchant, [...meses, ...meses.map((d) => d.replace("-0", "-1"))], 120));
  }

  it("pega o sufixo: ATACADISTA, SUPERMERCADOS, HORTIFRUTIS", () => {
    for (const nome of ["ASSAI ATACADISTA", "PAO DE ACUCAR SUPERMERCADOS", "OBA HORTIFRUTIS"]) {
      expect(so(nome)[0]?.key, nome).toBe("mercado");
    }
  });

  it("MERCADOLIVRE não é mercearia", () => {
    // Marketplace, não mercado. `mercad\w*` casaria e estragaria tudo.
    expect(so("MERCADOLIVRE MERCADOL")[0]?.key).not.toBe("mercado");
  });
});

describe("a regua e o proprio habito da casa", () => {
  /**
   * MEDIDO nos oito meses reais: 70,9% da alimentacao cai em dia util, quase o
   * mesmo que os 5/7 do calendario. Numa casa assim, "metade no fim de semana"
   * ja e 1,7x o normal. Numa casa que quase so gasta no fim de semana, o mesmo
   * 50% e o contrario: e uma loja de dia util.
   */
  it("nao acusa fim de semana quando a casa toda gasta no fim de semana", () => {
    // Base: 8 no fim de semana contra 4 em dia util - o normal aqui e sabado.
    const transactions = [
      ...loja("BAR DO ZE", FDS, 50),
      ...loja("CANTINA", UTEIS.slice(0, 4), 40),
      // Meio a meio: abaixo da base de dia util, mas ACIMA da base de fim de
      // semana. Nao e padrao de fim de semana nenhum.
      ...loja("PADARIA", [...FDS.slice(0, 3), ...UTEIS.slice(4, 7)], 30),
    ];

    const fds = suggestSubcategories(transactions).find(
      (s) => s.key === "fim_de_semana",
    );
    const lojas = fds?.merchants.map((m) => m.merchant) ?? [];
    expect(lojas).not.toContain("PADARIA");
  });

  it("numa casa de dia util, meio a meio conta como fim de semana", () => {
    const transactions = [
      // Base parecida com a real: maioria em dia util.
      ...loja("SUBITO", UTEIS, 43),
      ...loja("SHOKITI", UTEIS.slice(0, 6), 38),
      // Datas espalhadas por tres meses: meio a meio num mes so seria mes
      // atipico, e proposta feita de um mes so ensina o app a errar sempre.
      ...loja("PADARIA", [FDS[0]!, FDS[4]!, FDS[7]!, UTEIS[0]!, UTEIS[4]!, UTEIS[8]!], 55),
    ];

    const fds = suggestSubcategories(transactions).find(
      (s) => s.key === "fim_de_semana",
    );
    expect(fds?.merchants.map((m) => m.merchant)).toContain("PADARIA");
  });
});

describe("assinatura não é comportamento", () => {
  /**
   * O caso que criou esta regra, saído dos dados reais: o motor propunha, com
   * toda a confiança, "Assinaturas > Fim de semana" para um serviço que cobra
   * todo domingo, e "Assinaturas > Rotina de dia útil" para streaming. Nenhuma
   * das duas diz nada — o dia de uma assinatura é o do faturamento do
   * fornecedor, não o da vida de quem paga.
   */
  function assinatura(merchant: string, datas: string[], valor: number) {
    return datas.map((d) => tx({ date: d, merchantNormalized: merchant, amount: valor }));
  }

  it("serviço que cobra todo domingo não vira gasto de fim de semana", () => {
    // 11 cobranças, todas em fim de semana, todas do mesmo valor.
    const domingos = [
      "2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28",
      "2026-07-05", "2026-07-12", "2026-07-19", "2026-07-26",
      "2026-08-02", "2026-08-09", "2026-08-16",
    ];
    const sugestoes = suggestSubcategories(assinatura("SERVICO AI", domingos, 53.99));
    expect(sugestoes).toEqual([]);
  });

  it("streaming cobrado em dia útil não vira rotina de dia útil", () => {
    const sugestoes = suggestSubcategories([
      ...assinatura("STREAMING", UTEIS.slice(0, 6), 79.9),
      ...assinatura("OUTRO STREAMING", UTEIS.slice(2, 8), 29.9),
    ]);
    expect(sugestoes).toEqual([]);
  });

  it("cobrança que muda de valor mas cai sempre no mesmo dia do mês também sai", () => {
    // O caso do serviço por uso: o valor varia, mas o dia é do faturamento.
    const todoDia16 = ["2026-05-16", "2026-06-16", "2026-07-16", "2026-08-16"];
    const sugestoes = suggestSubcategories([
      ...todoDia16.map((d, i) =>
        tx({ date: d, merchantNormalized: "SERVICO POR USO", amount: 40 + i * 11 }),
      ),
      ...todoDia16.map((d, i) =>
        tx({ date: d, merchantNormalized: "OUTRO POR USO", amount: 25 + i * 7 }),
      ),
    ]);
    expect(sugestoes).toEqual([]);
  });

  it("mas um restaurante que varia de valor continua propondo", () => {
    // A contraprova: sem ela, a regra poderia estar calando tudo.
    const sugestoes = suggestSubcategories(loja("SUBITO RICE", UTEIS, 43.52));
    expect(sugestoes.find((s) => s.key === "rotina")).toBeDefined();
  });
});
