import { describe, expect, it } from "vitest";
import { columnIndex, readWorkbook } from "@/lib/xlsx";
import { zip } from "./helpers/zip";

/**
 * O leitor de .xlsx.
 *
 * DE ONDE VEM A CONFIANCA, e vale ser exato sobre isto: o leitor foi rodado
 * contra o arquivo REAL de quem usa o app - seis abas, 43 KB saidos do Excel,
 * com textos compartilhados, formula com valor em cache, hyperlink guardado
 * nas relacoes da aba e colunas puladas. Foi ali que ele foi conferido linha a
 * linha. O arquivo nao entra no repositorio porque e a obra da casa, entao o
 * que estes testes fazem e MONTAR UM ZIP DE VERDADE com as mesmas pecas - zip
 * comprimido e zip guardado sem compressao, os dois no mesmo arquivo - para
 * que uma quebra futura apareca aqui.
 */

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const LIVRO = zip([
  {
    nome: "xl/workbook.xml",
    conteudo: `<workbook ${NS}><sheets><sheet name="Lista Loja" sheetId="1" r:id="rId1"/><sheet name="Resumo" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  },
  {
    nome: "xl/_rels/workbook.xml.rels",
    conteudo: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
  },
  {
    nome: "xl/sharedStrings.xml",
    // A segunda `si` e texto rico partido em dois `t`, como o Excel grava
    // quando parte da celula esta em negrito.
    conteudo: `<sst ${NS}><si><t>Produto</t></si><si><r><t>Piso </t></r><r><t>Vinílico</t></r></si><si><t>Abrir anúncio</t></si></sst>`,
    guardado: true,
  },
  {
    nome: "xl/worksheets/sheet1.xml",
    conteudo: `<worksheet ${NS}><sheetData>
      <row r="2"><c r="B2" t="s"><v>0</v></c><c r="D2" t="inlineStr"><is><t>Custo estimado</t></is></c></row>
      <row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3" t="str"><f>A1</f><v>m²</v></c><c r="D3"><v>3306.589</v></c><c r="E3" t="s"><v>2</v></c></row>
      <row r="5"><c r="B5" t="e"><v>#REF!</v></c></row>
    </sheetData><hyperlinks><hyperlink ref="E3" r:id="rIdL1"/></hyperlinks></worksheet>`,
  },
  {
    nome: "xl/worksheets/_rels/sheet1.xml.rels",
    conteudo: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://exemplo.com/piso" TargetMode="External"/></Relationships>`,
  },
  {
    nome: "xl/worksheets/sheet2.xml",
    conteudo: `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Resumo</t></is></c></row></sheetData></worksheet>`,
  },
]);

describe("columnIndex", () => {
  it("lê a letra da referência da célula", () => {
    // MEDIDO: o Excel OMITE celula vazia. Sem ler a letra, uma linha que pula
    // da coluna B para a P entraria deslocada, e o preco de um item cairia na
    // coluna da quantidade do outro.
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("B10")).toBe(1);
    expect(columnIndex("S54")).toBe(18);
    expect(columnIndex("AA2")).toBe(26);
  });
});

describe("readWorkbook", () => {
  it("abre as abas na ordem do arquivo", async () => {
    const abas = await readWorkbook(LIVRO);
    expect(abas.map((a) => a.name)).toEqual(["Lista Loja", "Resumo"]);
  });

  it("põe cada célula na coluna certa, com os buracos preservados", async () => {
    const [aba] = await readWorkbook(LIVRO);
    // A linha 2 do arquivo e o indice 1 da grade, e C2 nao existe.
    expect(aba!.grid[1]).toEqual([null, "Produto", null, "Custo estimado"]);
    // Linha 1 e 4 nao existem no arquivo: viram linhas vazias, e nao somem.
    expect(aba!.grid[0]).toEqual([]);
    expect(aba!.grid[3]).toEqual([]);
  });

  it("remonta texto rico, lê fórmula pelo valor em cache e guarda número como número", async () => {
    const [aba] = await readWorkbook(LIVRO);
    expect(aba!.grid[2]![1]).toBe("Piso Vinílico");
    expect(aba!.grid[2]![2]).toBe("m²");
    expect(aba!.grid[2]![3]).toBe(3306.589);
  });

  it("troca o rótulo do link pelo endereço", async () => {
    // "Abrir anúncio" e como a celula se apresenta, nao o que ela guarda - e o
    // endereco e justamente o que serve na hora de comprar.
    const [aba] = await readWorkbook(LIVRO);
    expect(aba!.grid[2]![4]).toBe("https://exemplo.com/piso");
  });

  it("célula com erro fica vazia, e não vira nome de item", async () => {
    const [aba] = await readWorkbook(LIVRO);
    expect(aba!.grid[4]![1]).toBeNull();
  });

  it("diz o que houve quando o arquivo não é uma planilha", async () => {
    await expect(readWorkbook(new TextEncoder().encode("não sou um zip").buffer)).rejects.toThrow(
      /não parece um arquivo/,
    );
  });
});
