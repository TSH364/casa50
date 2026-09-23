import { describe, expect, it } from "vitest";
import { parseCsv } from "@/importers/parse";
import { excelSerialToIso, parseSheet } from "@/importers/sheet";
import { readWorkbook, type SheetData } from "@/lib/xlsx";
import { zip } from "./helpers/zip";

/**
 * Fatura em planilha.
 *
 * O TESTE QUE SUSTENTA ESTE ARQUIVO E O DE EQUIVALENCIA: a mesma fatura do
 * Itau que o importador de CSV foi medido contra - o recorte fiel que esta em
 * `importers.test.ts` - montada como uma planilha de banco de verdade, e a
 * exigencia de que as duas saiam IDENTICAS.
 *
 * Nao ha uma fatura .xlsx real deste banco no repositorio, e isto nao finge o
 * contrario. O que o teste garante e mais estreito e mais util: tudo o que ja
 * foi medido no CSV - a coluna em real e nao em dolar, o estorno que nao some,
 * a parcela na coluna propria - continua valendo quando a mesma fatura chega
 * como planilha, com as tres coisas que uma planilha faz diferente: cabecalho
 * do banco em cima, data como numero, valor como numero.
 */

const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Inverso de `excelSerialToIso`, so para montar o fixture. */
function isoToSerial(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(a!, m! - 1, d!) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function brToIso(br: string): string {
  const [d, m, a] = br.split("/");
  return `${a}-${m}-${d}`;
}

const COLUNAS = "ABCDEFGHIJ";

function celula(ref: string, valor: string | number): string {
  if (typeof valor === "number") return `<c r="${ref}"><v>${valor}</v></c>`;
  const esc = valor.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc}</t></is></c>`;
}

function linha(n: number, valores: (string | number | null)[]): string {
  return `<row r="${n}">${valores
    .map((v, i) => (v === null ? "" : celula(`${COLUNAS[i]}${n}`, v)))
    .join("")}</row>`;
}

function livro(linhas: string[], opcoes: { date1904?: boolean } = {}): ArrayBuffer {
  return zip([
    {
      nome: "xl/workbook.xml",
      conteudo: `<workbook ${NS}>${opcoes.date1904 ? '<workbookPr date1904="1"/>' : ""}<sheets><sheet name="Fatura" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      nome: "xl/_rels/workbook.xml.rels",
      conteudo: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      nome: "xl/worksheets/sheet1.xml",
      conteudo: `<worksheet ${NS}><sheetData>${linhas.join("")}</sheetData></worksheet>`,
    },
  ]);
}

// O recorte fiel do CSV real do Itau, identico ao de `importers.test.ts`.
const CABECALHO = [
  "Data de Compra",
  "Nome no Cartão",
  "Final do Cartão",
  "Categoria",
  "Descrição",
  "Parcela",
  "Valor (em US$)",
  "Cotação (em R$)",
  "Valor (em R$)",
];
const LINHAS_CSV = [
  "27/11/2025;VINICIUS ROSELLI;2150;Empresa serviços;GOOGLE YOUTUBE;Única;0;0;26.90",
  "03/12/2025;VINICIUS ROSELLI;2150;Elétrico;OPENAI *CHATGPT SUBSCR SA;Única;20.00;5.63;112.53",
  "14/10/2025;VINICIUS ROSELLI;6869;Educacional;ADAPTAORG;2/12;0;0;99.00",
  "05/12/2025;VINICIUS ROSELLI;6869;-;Inclusao de Pagamento;Única;0;0;-18151.91",
  "23/12/2025;VINICIUS ROSELLI;6869;-;Anuidade Diferenciada;12/12;0;0;98.00",
  "23/12/2025;VINICIUS ROSELLI;6869;-;Estorno Tarifa;Única;0;0;-98.00",
  "04/06/2025;VINICIUS ROSELLI;0162;Transporte;AIRBNB * HMKHDBT8PZ;7/7;0;0;2163.58",
  "10/05/2026;VINICIUS ROSELLI;0162;Empresa para empresa;MERCADOLIVRE*CIAPNEUS;Única;0;0;-473.73",
  "10/05/2026;VINICIUS ROSELLI;0162;Empresa para empresa;MERCADOLIVRE*CIAPNEUS;Única;0;0;473.73",
];
const CSV = [CABECALHO.join(";"), ...LINHAS_CSV].join("\n");

/**
 * A MESMA fatura, como um banco exportaria em planilha:
 *   - cinco linhas de cabecalho do banco antes da tabela;
 *   - data como numero de serie do Excel;
 *   - valores como numero, e nao texto;
 *   - o final do cartao como NUMERO - a armadilha classica: "0162" vira 162.
 */
function planilhaDoBanco(): ArrayBuffer {
  const preambulo = [
    linha(1, ["Banco Itaú S.A."]),
    linha(2, ["Fatura do cartão de crédito"]),
    linha(3, ["Vencimento:", "05/01/2026"]),
    linha(4, ["Total da fatura:", null, null, null, null, null, null, null, -16128.52]),
    linha(5, []),
  ];
  const cabecalho = linha(6, CABECALHO);
  const dados = LINHAS_CSV.map((l, i) => {
    const c = l.split(";");
    return linha(7 + i, [
      isoToSerial(brToIso(c[0]!)),
      c[1]!,
      Number(c[2]),
      c[3]!,
      c[4]!,
      c[5]!,
      Number(c[6]),
      Number(c[7]),
      Number(c[8]),
    ]);
  });
  return livro([...preambulo, cabecalho, ...dados]);
}

const OPCOES = { fileName: "Fatura_20260105.xlsx" };

describe("excelSerialToIso", () => {
  it("converte o número de série do Excel em data", () => {
    // A origem e 30/12/1899 por causa do 29/02/1900 que o Excel conta e que
    // nunca existiu.
    expect(excelSerialToIso(46_281)).toBe("2026-09-16");
    expect(excelSerialToIso(45_988)).toBe("2025-11-27");
  });

  it("ignora a fração do dia", () => {
    // Data com hora vem como 46281.75 - o dia continua sendo o 16.
    expect(excelSerialToIso(46_281.75)).toBe("2026-09-16");
  });

  it("respeita a origem de 1904 do Excel antigo de Mac", () => {
    // Lida com a origem errada, toda a fatura andaria quatro anos sem erro.
    expect(excelSerialToIso(44_819, true)).toBe("2026-09-16");
  });
});

describe("parseSheet — a fatura do Itaú como planilha", () => {
  it("sai IDÊNTICA à mesma fatura em CSV", async () => {
    const abas = await readWorkbook(planilhaDoBanco());
    const planilha = parseSheet(abas, OPCOES);
    const csv = parseCsv(CSV, { fileName: "Fatura_20260105.csv" });

    expect(planilha.drafts).toHaveLength(9);
    expect(planilha.drafts).toEqual(csv.drafts);
    expect(planilha.columns).toEqual(csv.columns);
    expect(planilha.signConvention).toBe(csv.signConvention);
    expect(planilha.detectedMonth).toBe("2026-01");
  });

  it("acha o cabeçalho abaixo do preâmbulo do banco", async () => {
    const abas = await readWorkbook(planilhaDoBanco());
    const r = parseSheet(abas, OPCOES);
    expect(r.format).toBe("xlsx");
    expect(r.issues.some((i) => /linha 6/.test(i.message))).toBe(true);
    // "Total da fatura" esta acima do cabecalho e nao pode virar lancamento.
    expect(r.drafts.some((d) => /total/i.test(d.description))).toBe(false);
  });

  it("devolve o zero à esquerda do final do cartão", async () => {
    // A ARMADILHA: guardado como numero, "0162" vira 162, e o cartao 0162 -
    // o da casa - nunca casaria com o cadastrado. Todo lancamento dele ficaria
    // sem cartao.
    const abas = await readWorkbook(planilhaDoBanco());
    const r = parseSheet(abas, OPCOES);
    const airbnb = r.drafts.find((d) => d.description.startsWith("AIRBNB"));
    expect(airbnb?.cardLastFour).toBe("0162");
  });

  it("lê o valor em real, e não o em dólar, também na planilha", async () => {
    const abas = await readWorkbook(planilhaDoBanco());
    const r = parseSheet(abas, OPCOES);
    expect(r.columns.amount).toBe("Valor (em R$)");
    expect(r.drafts.every((d) => d.amountCents !== 0)).toBe(true);
  });
});

describe("parseSheet — quando não dá", () => {
  it("diz onde procurou quando não acha a tabela", () => {
    const abas: SheetData[] = [
      { name: "Resumo", grid: [["Limite total", 10000], ["Disponível", 3200]] },
    ];
    const r = parseSheet(abas, OPCOES);
    expect(r.drafts).toHaveLength(0);
    expect(r.issues[0]?.level).toBe("error");
    expect(r.issues[0]?.message).toMatch(/Não achei a tabela/);
  });

  it("pula a aba de resumo e lê a de lançamentos, dizendo qual leu", () => {
    const abas: SheetData[] = [
      { name: "Resumo", grid: [["Limite total", 10000]] },
      {
        name: "Lançamentos",
        grid: [
          ["Data", "Descrição", "Valor"],
          ["2026-09-02", "PG *99 RIDE", 32.9],
        ],
      },
    ];
    const r = parseSheet(abas, OPCOES);
    expect(r.drafts).toHaveLength(1);
    expect(r.issues.some((i) => /Lançamentos/.test(i.message))).toBe(true);
  });

  it("não inventa data a partir de número fora da faixa do Excel", () => {
    // "20260916" escrito como numero nao e serie do Excel - convertido, daria
    // o ano 57.000. Melhor recusar a linha e avisar.
    const abas: SheetData[] = [
      {
        name: "Fatura",
        grid: [
          ["Data", "Descrição", "Valor"],
          [20260916, "LOJA", 10],
        ],
      },
    ];
    const r = parseSheet(abas, OPCOES);
    expect(r.drafts).toHaveLength(0);
    expect(r.issues.some((i) => /Data não reconhecida/.test(i.message))).toBe(true);
  });

  it("colunas com o mesmo nome não se sobrescrevem", () => {
    const abas: SheetData[] = [
      {
        name: "Fatura",
        grid: [
          ["Data", "Descrição", "Valor", "Valor"],
          ["2026-09-02", "LOJA", 0, 45.5],
        ],
      },
    ];
    const r = parseSheet(abas, OPCOES);
    expect(r.headers).toEqual(["Data", "Descrição", "Valor", "Valor (2)"]);
  });

  it("lê a origem 1904 do próprio arquivo", async () => {
    const abas = await readWorkbook(
      livro(
        [linha(1, ["Data", "Descrição", "Valor"]), linha(2, [44_819, "LOJA", 10])],
        { date1904: true },
      ),
    );
    expect(abas[0]?.date1904).toBe(true);
    expect(parseSheet(abas, OPCOES).drafts[0]?.date).toBe("2026-09-16");
  });
});
