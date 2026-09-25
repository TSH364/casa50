import { describe, expect, it } from "vitest";
import { amountsInText, parseQuoteAnswer, QUOTE_PROMPT } from "@/domain/quote-ai";

/**
 * A resposta da IA, conferida.
 *
 * O RISCO QUE ESTE ARQUIVO GUARDA: o leitor por regra escolhe entre numeros
 * que estao no documento - erra, mas nunca inventa. Um modelo pode devolver
 * um numero que nao esta escrito em lugar nenhum. Cada teste de "conferencia"
 * abaixo e sobre saber a diferenca.
 *
 * O documento usado e o do orcamento real que derrubou o leitor por regra
 * quatro vezes (ver `quote-pdf.test.ts`): numero do orcamento, cidade com data
 * por extenso, telefone - tudo o que parece valor e nao e.
 */

const REAL = [
  "16/09/2026 1/1 Orçamento(RV0) - IF - n° 938",
  "N° 938",
  "Santana do Parnaiba, 16 de setembro de 2026",
  "ITEM AMBIENTE MATERIAL SERVIÇO Un. Total",
  "1 Cozinha Bancada em granito 1 4.850,00",
  "2 Banho Soleira 2 620,00",
  "Subtotal 5.470,00",
  "Desconto à vista 270,00",
  "TOTAL 5.200,00",
  "Prazo de 15 dias após aprovação. (11) 99023-2728",
].join("\n");

describe("o pedido ao modelo", () => {
  it("nomeia cada armadilha que o leitor por regra já caiu", () => {
    // O modelo recebe a lista escrita. Cada item e um erro de verdade num
    // orcamento de quem usa.
    for (const armadilha of ["telefone", "CNPJ", "número do orçamento", "ano"]) {
      expect(QUOTE_PROMPT).toContain(armadilha);
    }
    expect(QUOTE_PROMPT).toMatch(/não invente/i);
  });
});

describe("parseQuoteAnswer — lendo a resposta", () => {
  it("lê o JSON pedido", () => {
    const r = parseQuoteAnswer(
      '{"fornecedor":"Marmoraria IF","total":5200,"data":"2026-09-16","outros_valores":[{"valor":5470,"rotulo":"subtotal"}]}',
      "texto",
      REAL,
    );
    expect(r).toMatchObject({
      supplier: "Marmoraria IF",
      quotedOn: "2026-09-16",
      total: { cents: 520_000, confidence: "alta" },
    });
    expect(r?.alternatives.map((a) => a.cents)).toEqual([547_000]);
  });

  it("acha o JSON mesmo com cerca de código e frase em volta", () => {
    // Pedido "só JSON", e mesmo assim modelo embrulha. Nao e erro de leitura.
    const r = parseQuoteAnswer(
      'Aqui está:\n```json\n{"fornecedor":null,"total":5200,"data":null}\n```',
      "texto",
      REAL,
    );
    expect(r?.total?.cents).toBe(520_000);
  });

  it("aceita valor escrito como texto em formato brasileiro", () => {
    const r = parseQuoteAnswer('{"total":"5.200,00"}', "texto", REAL);
    expect(r?.total?.cents).toBe(520_000);
  });

  it("sem JSON legível, devolve null para cair no leitor por regra", () => {
    expect(parseQuoteAnswer("Não consegui ler o documento.", "texto", REAL)).toBeNull();
    expect(parseQuoteAnswer('{"total": 52', "texto", REAL)).toBeNull();
  });

  it("recusa total zero, negativo ou absurdo", () => {
    expect(parseQuoteAnswer('{"total":0}', "imagem")?.total).toBeNull();
    expect(parseQuoteAnswer('{"total":-5200}', "imagem")?.total).toBeNull();
    // Dez milhoes de reais nao e orcamento de obra de casa: e leitura errada.
    expect(parseQuoteAnswer('{"total":99999999}', "imagem")?.total).toBeNull();
  });

  it("recusa data impossível ou fora de época", () => {
    expect(parseQuoteAnswer('{"data":"2026-02-31"}', "imagem")?.quotedOn).toBeNull();
    expect(parseQuoteAnswer('{"data":"1998-09-16"}', "imagem")?.quotedOn).toBeNull();
    expect(parseQuoteAnswer('{"data":"16/09/2026"}', "imagem")?.quotedOn).toBeNull();
  });

  it("não repete o total entre as alternativas", () => {
    const r = parseQuoteAnswer(
      '{"total":5200,"outros_valores":[{"valor":5200,"rotulo":"total"},{"valor":270,"rotulo":"desconto"},{"valor":270,"rotulo":"desconto"}]}',
      "texto",
      REAL,
    );
    expect(r?.alternatives.map((a) => a.cents)).toEqual([27_000]);
  });
});

describe("parseQuoteAnswer — conferindo contra o documento", () => {
  it("valor escrito no documento é confirmado", () => {
    const r = parseQuoteAnswer('{"total":5200}', "texto", REAL);
    expect(r?.total?.confidence).toBe("alta");
  });

  it("valor que NÃO está no documento é marcado, e diz por quê", () => {
    // O caso que a conferencia existe para pegar: R$ 5.300 nao esta escrito em
    // lugar nenhum do orcamento. Pode ser conta do modelo, pode ser invencao -
    // a tela avisa, e a pessoa decide.
    const r = parseQuoteAnswer('{"total":5300}', "texto", REAL);
    expect(r?.total?.cents).toBe(530_000);
    expect(r?.total?.confidence).toBe("baixa");
    expect(r?.total?.context).toMatch(/não encontrei este valor escrito/);
  });

  it("lido de imagem, não há o que conferir — e o resultado diz isso", () => {
    const r = parseQuoteAnswer('{"total":5200}', "imagem");
    expect(r?.total?.confidence).toBe("media");
    expect(r?.total?.context).toMatch(/lido da imagem/);
  });

  it("confere as alternativas também", () => {
    const r = parseQuoteAnswer(
      '{"total":5200,"outros_valores":[{"valor":5470,"rotulo":"subtotal"},{"valor":9999,"rotulo":"?"}]}',
      "texto",
      REAL,
    );
    expect(r?.alternatives.map((a) => a.confidence)).toEqual(["alta", "baixa"]);
  });
});

describe("amountsInText", () => {
  it("vê o mesmo valor escrito de jeitos diferentes", () => {
    // A pergunta e "este numero esta no papel?", e nao "qual e o total" - por
    // isso entra inteiro sem centavos: "R$ 4.000" e "4000" sao o mesmo valor.
    const v = amountsInText("Total R$ 4.000,00\nou 4000 à vista\n1.234,56");
    expect(v.has(400_000)).toBe(true);
    expect(v.has(123_456)).toBe(true);
  });
});
