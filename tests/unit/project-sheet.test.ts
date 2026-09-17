import { describe, expect, it } from "vitest";
import {
  cellText,
  mapColumns,
  readProjectSheet,
  scoreSheet,
  stageFromTitle,
  type Cell,
} from "@/domain/project-sheet";

/**
 * A planilha de itens de projeto.
 *
 * A GRADE ABAIXO E A FORMA DA PLANILHA REAL de quem usa o app - seis abas,
 * quatro blocos com cabecalhos diferentes na mesma aba, subtotal no meio,
 * observacao no fim, tres colunas de quantidade. Os nomes e os precos foram
 * trocados; a estrutura, nao. Cada caso deste arquivo derrubou o leitor numa
 * versao anterior, e o comentario de cada um diz o que ele quebrava.
 */

/** Monta uma linha esparsa: `{ 1: "Marca" }` vira `[null, "Marca"]`. */
function linha(celulas: Record<number, Cell>): Cell[] {
  const max = Math.max(...Object.keys(celulas).map(Number));
  const saida: Cell[] = new Array(max + 1).fill(null);
  for (const [i, v] of Object.entries(celulas)) saida[Number(i)] = v;
  return saida;
}

// A aba "lista de compras": comeca na coluna B, quatro secoes, cada uma com o
// seu cabecalho, subtotais entre elas e observacoes no fim.
const LISTA: Cell[][] = [
  [],
  linha({ 1: "LISTA DE COMPRAS — ACABAMENTOS DA OBRA" }),
  linha({ 1: "Levar na loja · quantidades já com perda", 16: "Data:", 17: 46282 }),
  [],
  linha({ 1: "Perda / quebra assumida (revestimentos):", 5: 0.1 }),
  linha({ 1: "CUSTO TOTAL ESTIMADO DA COMPRA:", 17: 15748.589 }),
  [],
  linha({ 1: "1. REVESTIMENTOS — comprar por m² (azulejos e pisos)" }),
  linha({
    1: "Marca",
    2: "Produto",
    4: "Unid.",
    5: "Qtd projeto (TOTAL)",
    6: "Banho",
    7: "Banho master",
    8: "Cozinha",
    9: "Lavabo",
    10: "Lavanderia",
    11: "Quartos",
    12: "Sala",
    13: "Sala - Escada",
    14: "Qtd + perda",
    15: "COMPRAR",
    16: "Preço unit.",
    17: "Custo estimado",
    18: "✓",
  }),
  linha({
    1: "Porcelana",
    2: "Linha Norte",
    4: "m²",
    5: 63.14,
    12: 42,
    14: 69.454000000000008,
    15: 69.5,
    16: 129,
    17: 8965.5,
    18: "☐",
  }),
  // Produto vazio: o nome tem de cair para a marca.
  linha({ 1: "Cerâmica Sul", 2: "—", 4: "m²", 5: 6.59, 8: 6.59, 15: 7.3, 16: 95, 17: 693.5 }),
  linha({ 1: "SUBTOTAL revestimentos", 5: 97.76, 15: 107.8, 17: 13148.589 }),
  [],
  linha({ 1: "2. TINTAS — comprar por balde" }),
  linha({
    1: "Marca",
    2: "Produto",
    4: "Unid.",
    5: "Baldes (cálc.)",
    14: "Área (m²)",
    15: "COMPRAR",
    16: "Preço unit.",
    17: "Custo estimado",
  }),
  // Preco zero: item sem cotacao, e nao item que custa nada.
  linha({ 1: "Tinta Boa", 2: "Areia", 4: "balde", 5: 1.2469, 15: 2, 16: 0, 17: 0 }),
  linha({ 1: "Tinta Boa", 2: "Chumbo", 4: "balde", 5: 2.173, 15: 3, 16: 220, 17: 660 }),
  linha({ 1: "SUBTOTAL tintas", 15: 5, 17: 660 }),
  [],
  linha({ 1: "3. LOUÇAS E METAIS — comprar por unidade" }),
  linha({
    1: "Item",
    2: "Especificação para mostrar na loja",
    3: "Link",
    4: "Unid.",
    15: "COMPRAR",
    16: "Preço unit.",
    17: "Custo estimado",
  }),
  linha({
    1: "Tanque inox 40x40",
    2: "Inox 304 fosco, c/ válvula e sifão",
    3: "https://exemplo.com/tanque",
    4: "un",
    15: 1,
    16: 0,
    17: 0,
  }),
  linha({ 1: "SUBTOTAL louças", 15: 1, 17: 0 }),
  linha({ 1: "TOTAL GERAL DA COMPRA", 17: 15748.589 }),
  [],
  linha({ 1: "Observações:" }),
  linha({ 1: "• Revestimentos já incluem a perda acima." }),
  [],
  linha({ 1: "Conferência — soma dos ambientes deve bater com o total:" }),
  linha({ 1: "Revestimentos (m²)", 4: 0, 5: "OK" }),
];

describe("cellText", () => {
  it("trata travessão sozinho como vazio", () => {
    // MEDIDO: um azulejo real tem Produto = "—". Sem isto o item se chamaria
    // "—" e ninguem acharia o que e.
    expect(cellText("—")).toBe("");
    expect(cellText("-")).toBe("");
    expect(cellText("n/a")).toBe("");
    expect(cellText("Porcelana")).toBe("Porcelana");
    expect(cellText(0)).toBe("0");
  });
});

describe("stageFromTitle", () => {
  it("tira o número e a explicação, e desfaz o grito", () => {
    expect(stageFromTitle("1. REVESTIMENTOS — comprar por m² (azulejos e pisos)")).toBe(
      "Revestimentos",
    );
    expect(stageFromTitle("3. BOX / VIDROS E OUTROS — comprar por unidade")).toBe(
      "Box / vidros e outros",
    );
    // Titulo ja escrito para gente fica como esta.
    expect(stageFromTitle("Louças e metais")).toBe("Louças e metais");
  });
});

describe("mapColumns", () => {
  it("prefere 'Item' a 'Descrição' para o nome", () => {
    // MEDIDO: trocar os dois daria uma lista com "Inox 304 fosco, 40x40x22cm,
    // ~22-25L, sobrepor/embutir..." como nome do item, ilegivel no celular.
    const mapa = mapColumns(["Item", "Descrição / Especificação", "Qtd", "Preço unit."]);
    expect(mapa.name).toBe(0);
    expect(mapa.note).toBe(1);
  });

  it("prefere 'COMPRAR' às outras colunas de quantidade", () => {
    const mapa = mapColumns(["Produto", "Qtd projeto (TOTAL)", "Qtd + perda", "COMPRAR"]);
    expect(mapa.quantity).toBe(3);
  });

  it("prefere o total da linha ao preço unitário", () => {
    // Gravar o unitario como se fosse o total erraria por um fator igual a
    // metragem: R$ 129 no lugar de R$ 8.965.
    const mapa = mapColumns(["Produto", "Preço unit.", "Custo estimado"]);
    expect(mapa.totalPrice).toBe(2);
    expect(mapa.unitPrice).toBe(1);
  });

  it("não dá a mesma coluna a dois campos", () => {
    const mapa = mapColumns(["Descrição", "Qtd"]);
    expect(mapa.name).toBe(0);
    expect(mapa.note).toBeNull();
  });
});

describe("readProjectSheet", () => {
  const leitura = readProjectSheet(LISTA);
  const nomes = leitura.items.map((i) => i.name);

  it("acha os itens das quatro seções, e só eles", () => {
    // O CASO QUE REESCREVEU A DETECCAO DE CABECALHO: oito das dezessete
    // colunas do cabecalho sao nomes de comodo, e exigir que metade fosse
    // palavra de tabela reprovava a linha - derrubando junto todos os itens
    // abaixo dela.
    expect(nomes).toEqual([
      "Linha Norte",
      "Cerâmica Sul",
      "Areia",
      "Chumbo",
      "Tanque inox 40x40",
    ]);
  });

  it("não confunde subtotal e total com item", () => {
    // A linha mais perigosa da planilha: "SUBTOTAL revestimentos" tem nome,
    // quantidade e R$ 13.148 preenchidos.
    expect(nomes).not.toContain("SUBTOTAL revestimentos");
    expect(nomes).not.toContain("TOTAL GERAL DA COMPRA");
    // Tres subtotais, o total geral, e a linha de conferencia do fim.
    expect(leitura.skipped.filter((s) => s.reason === "linha de soma")).toHaveLength(5);
  });

  it("encerra a tabela na observação, e a conferência não vira item", () => {
    // MEDIDO: sem isto, "Revestimentos (m²) | 0 | OK" entrava como item, com
    // unidade "0", sob o cabecalho de uma secao que acabara vinte linhas antes.
    expect(nomes).not.toContain("Revestimentos (m²)");
  });

  it("dá a cada item a etapa da seção em que ele está", () => {
    expect(leitura.items.map((i) => i.stage)).toEqual([
      "Revestimentos",
      "Revestimentos",
      "Tintas",
      "Tintas",
      "Louças e metais",
    ]);
  });

  it("usa a marca como nome quando o produto está vazio", () => {
    expect(leitura.items[1]).toMatchObject({ name: "Cerâmica Sul", supplier: "Cerâmica Sul" });
  });

  it("lê a quantidade de COMPRAR e limpa a sujeira de ponto flutuante", () => {
    // 69.454000000000008 e o que o Excel guarda para 63,14 x 1,1.
    expect(leitura.items[0]).toMatchObject({ quantity: 69.5, unit: "m²" });
    expect(readProjectSheet(LISTA, { quantityColumn: 14 }).items[0]?.quantity).toBe(69.454);
  });

  it("oferece as três colunas de quantidade para troca", () => {
    // A lista e por COLUNA, e nao por rotulo: as secoes reaproveitam as mesmas
    // colunas com nomes diferentes ("Qtd projeto" na primeira, "Baldes (calc.)"
    // na segunda), e oferecer a mesma coluna duas vezes so confundiria quem
    // escolhe. Fica o primeiro nome que ela teve.
    expect(leitura.quantityOptions.map((o) => o.label)).toEqual([
      "Qtd projeto (TOTAL)",
      "Qtd + perda",
      "COMPRAR",
    ]);
  });

  it("preço zero é item sem cotação, e não item que custa nada", () => {
    expect(leitura.items[2]).toMatchObject({ name: "Areia", amountCents: null });
    expect(leitura.items[3]?.amountCents).toBe(66000);
  });

  it("guarda o endereço do anúncio junto da especificação", () => {
    expect(leitura.items[4]?.note).toBe(
      "Inox 304 fosco, c/ válvula e sifão · https://exemplo.com/tanque",
    );
  });

  it("diz o motivo de cada linha que ficou de fora", () => {
    const motivos = new Set(leitura.skipped.map((s) => s.reason));
    expect(motivos).toContain("cabeçalho");
    expect(motivos).toContain("título de seção");
    expect(motivos).toContain("observação");
    expect(motivos).toContain("linha de soma");
  });
});

describe("linhas que não são item", () => {
  it("prosa numa célula sozinha não vira item", () => {
    // MEDIDO: 185 caracteres de instrucao numa celula so viravam um item de
    // obra com esse nome inteiro.
    const grade: Cell[][] = [
      linha({ 1: "Produto", 2: "Marca", 3: "Área (m²)" }),
      linha({ 1: "Chumbo", 2: "Tinta Boa", 3: 28.25 }),
      linha({
        1: "Área (verde) puxa da tabela Orçamento por marca+produto. Preencha só o Rendimento do balde e o R$/balde (azul). O R$/m² efetivo volta para a Plan1 automaticamente.",
      }),
    ];
    const r = readProjectSheet(grade);
    expect(r.items.map((i) => i.name)).toEqual(["Chumbo"]);
    expect(r.skipped.some((s) => s.reason === "texto solto")).toBe(true);
  });

  it("acha o nome numa coluna que nenhum campo reclamou", () => {
    // MEDIDO em "ITENS NOVOS (ainda fora do orcamento)": o nome esta na coluna
    // "Tipo", que nao e nome, nem marca, nem quantidade. Sem esta saida, os
    // itens que a casa ainda precisa cotar sumiam calados.
    const grade: Cell[][] = [
      linha({ 1: "Ambiente", 2: "Tipo", 3: "Marca", 4: "Produto", 5: "Qtd (m²)", 6: "Status" }),
      linha({ 1: "—", 2: "Mármore", 3: "—", 4: "—", 5: "—", 6: "⚠️ Falta cotar" }),
    ];
    expect(readProjectSheet(grade).items.map((i) => i.name)).toEqual(["Mármore"]);
  });

  it("calcula o total pelo unitário quando não há coluna de total", () => {
    const grade: Cell[][] = [
      linha({ 0: "Produto", 1: "Qtd", 2: "Preço unit." }),
      linha({ 0: "Rodapé", 1: 10, 2: 12.5 }),
    ];
    expect(readProjectSheet(grade).items[0]?.amountCents).toBe(12500);
  });

  it("zero não é quantidade", () => {
    // As colunas por ambiente trazem 0 para todo comodo que nao usa aquele
    // material; um item "0 m²" mentiria dizendo que ja esta comprado.
    const grade: Cell[][] = [
      linha({ 0: "Produto", 1: "Qtd", 2: "Custo estimado" }),
      linha({ 0: "Rodapé", 1: 0, 2: 100 }),
    ];
    expect(readProjectSheet(grade).items[0]?.quantity).toBeNull();
  });
});

describe("scoreSheet", () => {
  it("prefere a aba com mais itens distintos que têm número", () => {
    // MEDIDO: a planilha real tem seis abas legiveis. A primeira do arquivo
    // repete o mesmo porcelanato em quatro comodos; a lista de compras e que e
    // a lista de compras.
    const porAmbiente = readProjectSheet([
      linha({ 0: "Ambiente", 1: "Produto", 2: "m²", 3: "Total" }),
      linha({ 0: "Sala", 1: "Linha Norte", 2: 42, 3: 5418 }),
      linha({ 0: "Banho", 1: "Linha Norte", 2: 2.5, 3: 322.5 }),
      linha({ 0: "Lavabo", 1: "Linha Norte", 2: 2, 3: 258 }),
    ]);
    const cronograma = readProjectSheet([
      linha({ 0: "Ordem", 1: "Etapa", 2: "Descrição", 3: "Status" }),
      linha({ 0: 1, 1: "Infraestrutura", 2: "Elétrica e hidráulica", 3: "A fazer" }),
      linha({ 0: 2, 1: "Contrapiso", 2: "Regularização do piso", 3: "A fazer" }),
    ]);

    expect(scoreSheet(readProjectSheet(LISTA))).toBe(5);
    expect(scoreSheet(porAmbiente)).toBe(1);
    // Cronograma nao tem quantidade nem preco: nao e lista de compras.
    expect(scoreSheet(cronograma)).toBe(0);
  });
});
