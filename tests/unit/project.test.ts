import { describe, expect, it } from "vitest";
import {
  byStage,
  itemProgress,
  projectSummary,
  savingsFromChoices,
  type ProjectItem,
  type ProjectPurchase,
  type ProjectQuote,
} from "@/domain/project";

let seq = 0;

function item(partial: Partial<ProjectItem> = {}): ProjectItem {
  seq += 1;
  return {
    id: `i${seq}`,
    stage: null,
    name: "Item",
    unit: null,
    plannedQuantity: null,
    note: null,
    sortOrder: 0,
    closedAt: null,
    quotes: [],
    purchases: [],
    ...partial,
  };
}

function quote(partial: Partial<ProjectQuote> = {}): ProjectQuote {
  seq += 1;
  return {
    id: `q${seq}`,
    supplier: "Fornecedor",
    amountCents: 100_000,
    quantity: null,
    isChosen: false,
    note: null,
    quotedOn: null,
    ...partial,
  };
}

function purchase(partial: Partial<ProjectPurchase> = {}): ProjectPurchase {
  seq += 1;
  return {
    id: `p${seq}`,
    quantity: null,
    amountCents: 50_000,
    date: "2026-09-10",
    supplier: null,
    transactionId: null,
    ...partial,
  };
}

/** O caso do pedido: 60 m² de porcelanato, comprados aos poucos. */
const PORCELANATO = {
  name: "Porcelanato da sala",
  unit: "m²",
  plannedQuantity: 60,
};

describe("o que foi comprado, o que não foi, o que foi pela metade", () => {
  it("sem compra nenhuma é 'não comprado'", () => {
    const r = itemProgress(item({ ...PORCELANATO, quotes: [quote()] }));
    expect(r.status).toBe("nao_comprado");
    expect(r.spentCents).toBe(0);
    expect(r.ratio).toBe(0);
  });

  it("40 de 60 m² é parcial, e a fração é da QUANTIDADE", () => {
    // A decisão que desenha o módulo: parcial é de quantidade, não de
    // dinheiro. Aqui o valor já passou de dois terços do previsto e mesmo
    // assim o item está a 2/3 — porque o que falta é material, não pagamento.
    const r = itemProgress(
      item({
        ...PORCELANATO,
        quotes: [quote({ amountCents: 300_000, isChosen: true })],
        purchases: [
          purchase({ quantity: 25, amountCents: 130_000 }),
          purchase({ quantity: 15, amountCents: 90_000 }),
        ],
      }),
    );
    expect(r.status).toBe("parcial");
    expect(r.boughtQuantity).toBe(40);
    expect(r.ratio).toBeCloseTo(40 / 60);
    expect(r.spentCents).toBe(220_000);
    expect(r.remainingCents).toBe(80_000);
  });

  it("fechando a quantidade, vira comprado", () => {
    const r = itemProgress(
      item({
        ...PORCELANATO,
        purchases: [purchase({ quantity: 60, amountCents: 300_000 })],
      }),
    );
    expect(r.status).toBe("comprado");
    expect(r.ratio).toBe(1);
  });

  it("o arredondamento da metragem não deixa o item parcial para sempre", () => {
    // Quantidade de obra sai de conta de área, e 59,999 é o mundo real, não
    // um caso de borda inventado.
    const r = itemProgress(
      item({ ...PORCELANATO, purchases: [purchase({ quantity: 59.9996 })] }),
    );
    expect(r.status).toBe("comprado");
  });

  it("comprar mais que o previsto não passa de 100%", () => {
    const r = itemProgress(
      item({ ...PORCELANATO, purchases: [purchase({ quantity: 70 })] }),
    );
    expect(r.ratio).toBe(1);
    expect(r.status).toBe("comprado");
  });
});

describe("item sem quantidade — mão de obra, verba", () => {
  /**
   * "Mão de obra elétrica" não tem o que contar. Aí o dinheiro responde, e
   * chamar de "não comprado" um serviço com metade paga seria mentir.
   */
  const ELETRICA = { name: "Mão de obra elétrica", unit: "vb" };

  it("metade paga é parcial", () => {
    const r = itemProgress(
      item({
        ...ELETRICA,
        quotes: [quote({ amountCents: 800_000, isChosen: true })],
        purchases: [purchase({ amountCents: 300_000 })],
      }),
    );
    expect(r.status).toBe("parcial");
    expect(r.ratio).toBeCloseTo(3 / 8);
    expect(r.remainingCents).toBe(500_000);
  });

  it("pago por inteiro é comprado", () => {
    const r = itemProgress(
      item({
        ...ELETRICA,
        quotes: [quote({ amountCents: 800_000, isChosen: true })],
        purchases: [purchase({ amountCents: 800_000 })],
      }),
    );
    expect(r.status).toBe("comprado");
  });

  it("quem estourou o previsto mostra quanto passou", () => {
    const r = itemProgress(
      item({
        ...ELETRICA,
        quotes: [quote({ amountCents: 800_000, isChosen: true })],
        purchases: [purchase({ amountCents: 950_000 })],
      }),
    );
    expect(r.overCents).toBe(150_000);
    expect(r.remainingCents).toBe(0);
  });
});

describe("encerrar à mão", () => {
  it("sobra de material não deixa o item aberto para sempre", () => {
    // Comprou 55 dos 60 porque sobrou, e deu por encerrado. Sem esta saída o
    // item ficaria parcial até o fim da obra, virando ruído permanente.
    const r = itemProgress(
      item({
        ...PORCELANATO,
        closedAt: "2026-09-12T10:00:00Z",
        purchases: [purchase({ quantity: 55 })],
      }),
    );
    expect(r.status).toBe("comprado");
  });

  it("encerrado vence até a ausência de compras", () => {
    const r = itemProgress(item({ ...PORCELANATO, closedAt: "2026-09-12T10:00:00Z" }));
    expect(r.status).toBe("comprado");
  });
});

describe("cotações — várias propostas, uma escolha", () => {
  it("o previsto vem da escolhida", () => {
    const r = itemProgress(
      item({
        name: "Marcenaria",
        quotes: [
          quote({ supplier: "A", amountCents: 1_200_000 }),
          quote({ supplier: "B", amountCents: 900_000, isChosen: true }),
          quote({ supplier: "C", amountCents: 1_500_000 }),
        ],
      }),
    );
    expect(r.chosen?.supplier).toBe("B");
    expect(r.expectedCents).toBe(900_000);
  });

  it("sem escolha, o previsto é a MENOR recebida — e a tela sabe que não houve decisão", () => {
    // É a leitura honesta de "quanto isto sai" antes de decidir. `chosen`
    // continua nulo, então a tela nunca finge que a escolha foi feita.
    const r = itemProgress(
      item({
        name: "Marcenaria",
        quotes: [
          quote({ supplier: "A", amountCents: 1_200_000 }),
          quote({ supplier: "B", amountCents: 900_000 }),
        ],
      }),
    );
    expect(r.chosen).toBeNull();
    expect(r.expectedCents).toBe(900_000);
  });

  it("item sem cotação alguma não inventa previsto", () => {
    const r = itemProgress(item({ name: "A definir" }));
    expect(r.expectedCents).toBeNull();
    expect(r.remainingCents).toBe(0);
  });
});

describe("o retrato da obra inteira", () => {
  const obra = [
    item({
      stage: "Pisos",
      ...PORCELANATO,
      quotes: [quote({ amountCents: 300_000, isChosen: true })],
      purchases: [purchase({ quantity: 40, amountCents: 200_000 })],
    }),
    item({
      stage: "Elétrica",
      name: "Mão de obra",
      quotes: [quote({ amountCents: 800_000, isChosen: true })],
      purchases: [purchase({ amountCents: 800_000 })],
    }),
    item({ stage: "Marcenaria", name: "Armários", quotes: [quote({ amountCents: 1_500_000 })] }),
    item({ stage: null, name: "Luminárias a definir" }),
  ];

  it("soma previsto e gasto, e diz o que falta", () => {
    const s = projectSummary(obra);
    expect(s.expectedCents).toBe(2_600_000);
    expect(s.spentCents).toBe(1_000_000);
    expect(s.remainingCents).toBe(1_600_000);
  });

  it("conta quantos itens estão em cada estado", () => {
    const s = projectSummary(obra);
    expect(s.byStatus).toEqual({ nao_comprado: 2, parcial: 1, comprado: 1 });
  });

  it("diz de quantos itens o previsto NÃO fala", () => {
    // Sem este número, "previsto R$ 26.000" parece o custo da obra quando
    // pode ser o custo de metade dela.
    expect(projectSummary(obra).itemsWithoutQuote).toBe(1);
  });

  it("um item estourado não abate o que falta nos outros", () => {
    // Se `remainingCents` fosse previsto menos gasto no total, o item que
    // passou geraria falta negativa e esconderia o que ainda há para comprar.
    const s = projectSummary([
      item({ quotes: [quote({ amountCents: 100_000, isChosen: true })],
             purchases: [purchase({ amountCents: 500_000 })] }),
      item({ quotes: [quote({ amountCents: 100_000, isChosen: true })] }),
    ]);
    expect(s.remainingCents).toBe(100_000);
  });

  it("agrupa por etapa e deixa 'sem etapa' por último", () => {
    const grupos = byStage(projectSummary(obra).items);
    expect(grupos.map((g) => g.stage)).toEqual([
      "Elétrica",
      "Marcenaria",
      "Pisos",
      null,
    ]);
  });
});

describe("o que a escolha economizou", () => {
  it("compara a escolhida com a média das outras", () => {
    const s = savingsFromChoices([
      item({
        quotes: [
          quote({ amountCents: 900_000, isChosen: true }),
          quote({ amountCents: 1_200_000 }),
          quote({ amountCents: 1_500_000 }),
        ],
      }),
    ]);
    // Média das outras: 1.350.000. Escolheu por 900.000.
    expect(s).toBe(450_000);
  });

  it("proposta única não conta como economia", () => {
    // Sem concorrência não há o que comparar, e somar zeros que nunca foram
    // decisão de ninguém inflaria o número.
    expect(
      savingsFromChoices([item({ quotes: [quote({ isChosen: true })] })]),
    ).toBe(0);
  });

  it("sem escolha feita, ainda não há economia a declarar", () => {
    expect(
      savingsFromChoices([
        item({ quotes: [quote({ amountCents: 900_000 }), quote({ amountCents: 1_200_000 })] }),
      ]),
    ).toBe(0);
  });
});
