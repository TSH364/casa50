import { describe, expect, it } from "vitest";
import {
  linesFromTextItems,
  moneyCandidates,
  quotedOnFrom,
  readQuote,
  supplierFrom,
} from "@/domain/quote-pdf";

/**
 * Orçamento de fornecedor não tem formato: cada um escreve como quer. Os
 * textos abaixo imitam os formatos que aparecem na prática — papel timbrado
 * com CNPJ, tabela de itens com subtotais, total no rodapé.
 *
 * ATENÇÃO, e está dito no módulo também: estas regras ainda NÃO foram medidas
 * contra PDF real de quem vai usar. O resto do projeto mede antes de escrever
 * regra; aqui o que existe é palpite informado, e os testes travam o
 * comportamento pretendido para quando os arquivos de verdade chegarem.
 */

const MARCENARIA = `
MARCENARIA SANTA CRUZ LTDA
CNPJ: 12.345.678/0001-90
Rua das Palmeiras, 220 - CEP 01310-100

ORÇAMENTO Nº 2026/0451
Data: 14/09/2026
Validade: 30/10/2026

Cliente: Vinicius Roselli

ITEM            DESCRIÇÃO                     QTD   UNIT        TOTAL
1               Armário superior cozinha        3   1.250,00    3.750,00
2               Armário inferior com gavetas    2   2.100,00    4.200,00
3               Painel ripado sala              1   3.850,00    3.850,00

Subtotal                                                       11.800,00
Desconto à vista                                                    0,00
VALOR TOTAL                                                    11.800,00

Condições: 50% de entrada, saldo na entrega.
`;

describe("remontar as linhas da página", () => {
  /** Como o pdfjs entrega: pedaços soltos, cada um com seu Y. */
  const item = (str: string, y: number) => ({ str, transform: [1, 0, 0, 1, 0, y] });

  it("junta os pedaços da mesma linha, na ordem de leitura", () => {
    // O Y cresce para CIMA no PDF: o rodapé tem Y menor que o cabeçalho.
    const texto = linesFromTextItems([
      item("VALOR TOTAL", 300),
      item("11.800,00", 300),
      item("MARCENARIA SANTA CRUZ LTDA", 700),
      item("Subtotal", 340),
      item("11.800,00", 340),
    ]);
    expect(texto.split("\n")).toEqual([
      "MARCENARIA SANTA CRUZ LTDA",
      "Subtotal 11.800,00",
      "VALOR TOTAL 11.800,00",
    ]);
  });

  it("a mesma linha visual com Y ligeiramente diferente não se parte", () => {
    // Fonte maior numa célula desloca a base em fração de ponto, e uma linha
    // partida ao meio faria "VALOR TOTAL" deixar de qualificar o número.
    const texto = linesFromTextItems([item("VALOR TOTAL", 300), item("11.800,00", 301)]);
    expect(texto).toBe("VALOR TOTAL 11.800,00");
  });

  it("é isso que faz a tabela ser lida certo", () => {
    // Entregue como texto corrido, o "TOTAL" do cabeçalho da tabela
    // qualificaria o primeiro item e a leitura erraria todo orçamento que tem
    // tabela — ou seja, quase todos.
    const texto = linesFromTextItems([
      item("ITEM", 500), item("DESCRIÇÃO", 500), item("TOTAL", 500),
      item("1", 480), item("Armário", 480), item("3.750,00", 480),
      item("VALOR TOTAL", 400), item("11.800,00", 400),
    ]);
    expect(readQuote(texto).total?.cents).toBe(1_180_000);
  });

  it("pedaço vazio não vira linha", () => {
    expect(linesFromTextItems([item("  ", 300), item("Total 1.000,00", 200)])).toBe(
      "Total 1.000,00",
    );
  });
});

describe("o total da proposta", () => {
  it("acha o valor total, e não um item nem o subtotal", () => {
    const r = readQuote(MARCENARIA);
    expect(r.total?.cents).toBe(1_180_000);
    expect(r.total?.confidence).toBe("alta");
  });

  it("'subtotal' não é o fechamento, mesmo contendo 'total'", () => {
    // A armadilha real: numa proposta com três blocos há três subtotais
    // maiores que qualquer item e menores que o total.
    const candidatos = moneyCandidates("Subtotal 11.800,00");
    expect(candidatos[0]?.confidence).toBe("baixa");
  });

  it("entrada e parcela não são o valor da proposta", () => {
    const texto = `
VALOR TOTAL                 11.800,00
Entrada                      5.900,00
10 parcelas de                 590,00
`;
    const r = readQuote(texto);
    expect(r.total?.cents).toBe(1_180_000);
  });

  it("oferece as alternativas para quem quiser corrigir", () => {
    const r = readQuote(MARCENARIA);
    expect(r.alternatives.length).toBeGreaterThan(0);
    // Sem repetir o mesmo número: o total sai impresso duas vezes no arquivo.
    const valores = [r.total!.cents, ...r.alternatives.map((a) => a.cents)];
    expect(new Set(valores).size).toBe(valores.length);
  });

  it("lê as duas grafias de dinheiro que aparecem na prática", () => {
    // pt-BR e planilha exportada sem formatar.
    expect(moneyCandidates("VALOR TOTAL R$ 11.800,00")[0]?.cents).toBe(1_180_000);
    expect(moneyCandidates("VALOR TOTAL 11800.00")[0]?.cents).toBe(1_180_000);
    expect(moneyCandidates("VALOR TOTAL 11800")[0]?.cents).toBe(1_180_000);
  });

  it("CNPJ e CEP não viram dinheiro", () => {
    // "12.345.678/0001-90" tem cara de número grande; documento não é preço.
    expect(moneyCandidates("CNPJ: 12.345.678/0001-90")).toHaveLength(0);
    expect(moneyCandidates("Rua das Palmeiras, 220 - CEP 01310-100")).toHaveLength(0);
  });

  it("o ano da data não vira dinheiro", () => {
    // Defeito real, achado ao olhar o que o parser extraía em vez de confiar
    // no teste verde: "Data: 14/09/2026" produzia R$ 2.026,00, e o número
    // fantasma ia parar na lista de alternativas oferecida à pessoa.
    expect(moneyCandidates("Data: 14/09/2026")).toHaveLength(0);
    expect(moneyCandidates("Validade: 30/10/2026")).toHaveLength(0);
    // Mas uma linha com data E valor continua entregando o valor.
    const c = moneyCandidates("Orçamento de 14/09/2026 - Total 11.800,00");
    expect(c.map((x) => x.cents)).toEqual([1_180_000]);
  });

  it("texto sem valor nenhum não inventa total", () => {
    const r = readQuote("Prezado cliente, segue nossa proposta em anexo.");
    expect(r.total).toBeNull();
    expect(r.alternatives).toEqual([]);
  });
});

describe("de quem é a proposta", () => {
  it("pega a razão social a partir do CNPJ", () => {
    expect(supplierFrom(MARCENARIA)).toBe("MARCENARIA SANTA CRUZ LTDA");
  });

  it("razão social na mesma linha do CNPJ também vale", () => {
    expect(supplierFrom("ELÉTRICA JOÃO ME — CNPJ 11.222.333/0001-44")).toBe(
      "ELÉTRICA JOÃO ME",
    );
  });

  it("sem CNPJ, usa a primeira linha que pareça nome", () => {
    const texto = `
ORÇAMENTO
Data: 14/09/2026
Pisos & Cia
Total 3.000,00
`;
    expect(supplierFrom(texto)).toBe("Pisos & Cia");
  });

  it("não confunde rótulo com nome de empresa", () => {
    expect(supplierFrom("ORÇAMENTO\nData: 14/09/2026\n1.200,00")).toBeNull();
  });
});

describe("a data do documento", () => {
  it("pega a data, não a validade", () => {
    // "Validade: 30/10/2026" é quando vence, não quando foi feito — e ela
    // aparece logo abaixo da data no arquivo de exemplo.
    expect(quotedOnFrom(MARCENARIA)).toBe("2026-09-14");
  });

  it("ignora data impossível", () => {
    expect(quotedOnFrom("Data: 45/13/2026")).toBeNull();
  });

  it("sem data, não inventa", () => {
    expect(quotedOnFrom("Total 1.000,00")).toBeNull();
  });
});
