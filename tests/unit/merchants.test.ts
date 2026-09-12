import { describe, expect, it } from "vitest";
import {
  canonicalMerchant,
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
  it("mercearia de verdade não vira marketplace", () => {
    for (const nome of [
      "SUPERMERCADO PERIM",
      "LF MINIMERCADOS",
      "ADCMICROMERCADOS",
      "OBA HORTIFRUTI GRANJA",
      "MERCADO DO ZE",
    ]) {
      expect(canonicalMerchant(nome), nome).toBeNull();
    }
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
