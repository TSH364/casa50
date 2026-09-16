import { describe, expect, it } from "vitest";
import {
  canonicalMerchant,
  isCanonicalGrocery,
  isCanonicalMarketplace,
  merchantKey,
  merchantLabel,
} from "@/domain/merchants";
import type { Transaction } from "@/domain/types";

function tx(partial: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1", houseId: "casa", invoiceId: null, cardId: null, memberId: null,
    date: "2026-08-12", invoiceMonth: "2026-08", description: "COMPRA",
    merchantOriginal: null, merchantNormalized: null, merchantAlias: null,
    amount: 100, currency: "BRL", originalAmount: null, originalCurrency: null,
    type: "expense", origin: "invoice", status: "confirmed",
    categoryId: null, subcategoryId: null, note: null, receiptUrl: null,
    visibility: "shared", splitType: "none", splitPercentage: null,
    installment: null, recurringId: null, reconciledWithId: null,
    calendarEventId: null, eventLinkDecided: false, isHidden: false,
    isReconciled: false, createdBy: null, createdAt: "", updatedAt: "",
    ...partial,
  } as Transaction;
}

/** As QUINZE grafias do Mercado Livre que existem na base real. */
const MERCADO_LIVRE = [
  "MERCADOLIVRE 2PRODUTO",
  "MERCADOLIVRE MERCADOL",
  "MERCADOLIVRE 19PRODUT",
  "MERCADOLIVRE HORRA",
  "MERCADOLIVRE 9PRODUTOS",
  "MERCADOLIVRE TNTINFOL",
  "MERCADOLIVRE 9PRODUTO",
  "MERCADO MERCADOLIVRE",
  "MERCADOLIVRE CIAPNEUS",
  "MERCADOLIVRE RTM",
  "MERCADOLIVRE JHHUIH",
  "MERCADOLIVRE ARTBOX3D",
  "MERCADOLIVRE SUPERMAG",
  "MERCADOLIVRE 2PRODUTOS",
  "MERCADOLIVRE OIWEI",
];

/** As CINCO grafias da Amazon que existem na base real. */
const AMAZON = [
  "AMAZON BR",
  "AMAZONMKTPLC SAMSUNGEL",
  "AMAZONMKTPLC LCIMPORTA",
  "AMAZONMKTPLC COMERCIOC",
  "AMAZONMKTPLC REALSHOPP",
];

describe("juntar as grafias do mesmo marketplace", () => {
  it("as quinze grafias do Mercado Livre viram uma", () => {
    const nomes = new Set(MERCADO_LIVRE.map((m) => canonicalMerchant(m)));
    expect(nomes).toEqual(new Set(["Mercado Livre"]));
  });

  it("as cinco grafias da Amazon viram uma", () => {
    const nomes = new Set(AMAZON.map((m) => canonicalMerchant(m)));
    expect(nomes).toEqual(new Set(["Amazon"]));
  });

  it("agrupa por uma chave só", () => {
    const chaves = new Set(
      [...MERCADO_LIVRE, ...AMAZON].map((m) =>
        merchantKey(tx({ merchantNormalized: m })),
      ),
    );
    expect(chaves).toEqual(new Set(["Mercado Livre", "Amazon"]));
  });
});

describe("as armadilhas — o que NÃO pode ser juntado", () => {
  /**
   * Todos estes existem na base real e casariam com um `mercad\w*` solto. A
   * âncora no início do nome é o que os protege, e é a mesma lição que já
   * tinha aparecido nas regras de subcategoria.
   */
  it("mercearia avulsa não vira rede nem marketplace", () => {
    // Nenhuma destas é rede conhecida: são lojas soltas, e juntar grafia só
    // faz sentido onde existe uma rede para juntar.
    for (const nome of [
      "SUPERMERCADO PERIM",
      "LF MINIMERCADOS",
      "ADCMICROMERCADOS",
      "MERCADO DO ZE",
    ]) {
      expect(canonicalMerchant(nome), nome).toBeNull();
    }
  });

  it("rede de supermercado é juntada, mas NUNCA como marketplace", () => {
    // A distinção que decide o tratamento: no marketplace o sufixo é o
    // VENDEDOR e a loja não diz nada sobre o gasto; na rede o sufixo é a
    // UNIDADE e a loja diz exatamente o que é.
    expect(canonicalMerchant("OBA HORTIFRUTI GRANJA")).toBe("OBA Hortifruti");
    expect(isCanonicalMarketplace("OBA Hortifruti")).toBe(false);
    expect(isCanonicalGrocery("OBA Hortifruti")).toBe(true);

    expect(isCanonicalGrocery("Mercado Livre")).toBe(false);
    expect(isCanonicalMarketplace("Mercado Livre")).toBe(true);
  });

  it("a assinatura do marketplace não entra na cesta das compras", () => {
    // Meli+ está em Assinaturas enquanto as compras estão em Compras e TSH:
    // produtos diferentes da mesma empresa. Juntar o nome misturaria uma
    // mensalidade com compras avulsas.
    expect(canonicalMerchant("MELIMAIS")).toBeNull();
    expect(canonicalMerchant("AMAZON PRIME ALUGUEL")).toBeNull();
  });

  it("nome vazio ou nulo não inventa loja", () => {
    expect(canonicalMerchant(null)).toBeNull();
    expect(canonicalMerchant("")).toBeNull();
    expect(canonicalMerchant("   ")).toBeNull();
  });
});

describe("a decisão de gente vence a regra", () => {
  it("apelido escrito à mão manda no rótulo", () => {
    const t = tx({
      merchantNormalized: "MERCADOLIVRE CIAPNEUS",
      merchantAlias: "Pneus do carro",
    });
    expect(merchantLabel(t)).toBe("Pneus do carro");
  });

  it("sem apelido e sem regra, fica a descrição da fatura", () => {
    const t = tx({ merchantNormalized: "SUBITO RICE", description: "SUBITO RICE" });
    expect(merchantLabel(t)).toBe("SUBITO RICE");
  });
});

describe("a armadilha que só aparece DEPOIS de juntar", () => {
  it("o nome canônico contém a palavra que a regra de mercearia procura", () => {
    // Este teste existe como memória do tropeço, não como asserção de gosto:
    // "Mercado Livre" casa com /\bmercado\b/, que é a regra que reconhece
    // mercearia por nome. Juntar as grafias quebrava a classificação no mesmo
    // movimento, e o guarda em `classify` é o que impede.
    expect(/\bmercado\b/i.test("Mercado Livre")).toBe(true);
    expect(isCanonicalMarketplace("Mercado Livre")).toBe(true);
    expect(isCanonicalMarketplace("OBA HORTIFRUTI GRANJA")).toBe(false);
    expect(isCanonicalMarketplace(null)).toBe(false);
  });
});

describe("a empresa que trocou de nome no meio da série", () => {
  /**
   * MEDIDO: "HOME ASSISTANT CLOUD SA" cobra 12 vezes de 20/12/2025 a
   * 20/05/2026 e "NABU CASA HA CLOUD SA" continua de 20/06 a 20/07 — mesmo dia
   * do mês, série sem buraco, só o nome mudou. Nabu Casa é a empresa por trás
   * do Home Assistant Cloud.
   */
  it("as duas grafias viram uma assinatura só", () => {
    expect(canonicalMerchant("HOME ASSISTANT CLOUD SA")).toBe("Home Assistant Cloud");
    expect(canonicalMerchant("NABU CASA HA CLOUD SA")).toBe("Home Assistant Cloud");
  });

  it("não é marketplace nem mercearia — é serviço", () => {
    // O nome não pode cair em nenhuma das outras duas regras: não propõe
    // subcategoria de compra nem vira "mercado".
    expect(isCanonicalMarketplace("Home Assistant Cloud")).toBe(false);
    expect(isCanonicalGrocery("Home Assistant Cloud")).toBe(false);
  });

  it("a âncora protege o café que tem 'casa' no nome", () => {
    // "CASA PRETOLA CAFE" existe na base real e casaria com um `casa` solto.
    expect(canonicalMerchant("CASA PRETOLA CAFE")).toBeNull();
    expect(canonicalMerchant("CASA DO PAO DE QUEIJO")).toBeNull();
  });
});

describe("o espaço que a fatura põe e tira", () => {
  /**
   * MEDIDO nos 658 lançamentos reais: tirar o espaço junta EXATAMENTE um par
   * de nomes distintos, o da Apple. Nenhum outro colide. O risco de juntar
   * lojas diferentes existe no papel — a medição na base de verdade é o que
   * autoriza, não a intuição.
   */
  it("as duas grafias da Apple viram uma chave só", () => {
    const a = merchantKey(tx({ merchantNormalized: "APPLECOMBILL" }));
    const b = merchantKey(tx({ merchantNormalized: "APPLE COM BILL" }));
    expect(a).toBe(b);
  });

  it("a chave é identidade, e o nome canônico continua legível", () => {
    // O nome próprio sai inteiro, com espaço e acento: `isCanonicalGrocery`
    // compara contra ele por igualdade, e uma chave amassada o perderia.
    expect(merchantKey(tx({ merchantNormalized: "PAO DE ACUCAR 1885" }))).toBe(
      "Pão de Açúcar",
    );
    expect(isCanonicalGrocery("Pão de Açúcar")).toBe(true);
  });

  it("lojas diferentes continuam diferentes", () => {
    const nomes = ["SUBITO RICE", "SUPERMERCADO PERIM", "PARK SAUDE", "REPITA"];
    const chaves = nomes.map((n) => merchantKey(tx({ merchantNormalized: n })));
    expect(new Set(chaves).size).toBe(nomes.length);
  });
});

describe("redes de supermercado — o sufixo é a unidade, não o vendedor", () => {
  /**
   * MEDIDO na base real: o OBA aparece sob três grafias e o Pão de Açúcar sob
   * duas, separadas só pelo número ou bairro da loja. Isso tem consequência,
   * não é estética: o motor exige TRÊS lançamentos por estabelecimento, e
   * sozinhas duas das três linhas do OBA ficavam invisíveis para ele.
   */
  it("as três grafias do OBA viram uma", () => {
    const grafias = ["OBA HORTIFRUTI GRANJA", "OBA HORTIFRUTI", "OBA HORTIFRUTI JUNDIAI"];
    expect(new Set(grafias.map((g) => canonicalMerchant(g)))).toEqual(
      new Set(["OBA Hortifruti"]),
    );
  });

  it("as duas grafias do Pão de Açúcar viram uma, com acento de volta", () => {
    // O padrão casa a forma NORMALIZADA (sem acento), que é como o banco
    // grava; o nome canônico devolve os acentos para a tela.
    expect(canonicalMerchant("PAO DE ACUCAR 1885")).toBe("Pão de Açúcar");
    expect(canonicalMerchant("PAO DE ACUCAR 2050")).toBe("Pão de Açúcar");
  });

  it("o Pão de Açúcar não carrega nenhuma palavra genérica de mercearia", () => {
    // Esta é a razão de `isCanonicalGrocery` existir. A regra por palavra
    // procura "supermercado", "hortifruti", "atacadista" — e o nome não tem
    // nenhuma. Sem o reconhecimento por nome próprio, a rede seria julgada
    // pelo dia da semana e viraria refeição de fim de semana.
    const generica = /\b(mercado|feira|supermerc\w*|atacad\w*|hortifruti\w*)\b/i;
    expect(generica.test("Pão de Açúcar")).toBe(false);
    expect(isCanonicalGrocery("Pão de Açúcar")).toBe(true);
  });
});
