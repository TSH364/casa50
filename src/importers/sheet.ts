import type { Cell } from "@/domain/project-sheet";
import type { SheetData } from "@/lib/xlsx";
import { detectColumns } from "./detect";
import { buildDrafts, type ParseOptions } from "./parse";
import type { ParseResult } from "./types";

/**
 * Fatura em planilha (.xlsx).
 *
 * O QUE ISTO NAO E: um segundo leitor de fatura. As decisoes que custaram
 * medicao - qual coluna e a do valor em real, qual o sinal da despesa, qual o
 * mes da fatura, o que e parcela - ja moram em `buildDrafts`, e foram medidas
 * contra as faturas reais do Nubank e do Itau. Aqui so se resolve o que a
 * planilha tem de diferente do CSV, e sao duas coisas:
 *
 *   1. O CABECALHO NAO ESTA NA LINHA 1. Planilha de banco abre com o nome do
 *      banco, o titular, o periodo, o total - e so depois a tabela. O CSV
 *      assume a primeira linha como cabecalho; aqui isso leria "Banco Itau
 *      S.A." como nome de coluna e nao acharia data nem valor.
 *   2. A DATA E UM NUMERO. O Excel guarda 16/09/2026 como 46281, e mostra a
 *      data so porque a celula esta formatada. Lida crua, toda linha cairia em
 *      "Data nao reconhecida" - a fatura inteira ignorada, com um aviso por
 *      linha.
 *
 * O CABECALHO E ACHADO PELA MESMA DETECCAO DE COLUNAS DO CSV, e nao por uma
 * lista nova de palavras: a primeira linha em que `detectColumns` encontra
 * data, descricao e valor e o cabecalho. Assim, o que o app ja aprendeu sobre
 * fatura - "Valor (em R$)" antes de "Valor (em US$)", "Estabelecimento" como
 * descricao - vale igual para as duas fontes, e melhorar um melhora o outro.
 *
 * NAO MEDIDO CONTRA UMA FATURA .xlsx REAL ainda. O que esta medido e a
 * deteccao de colunas, que e compartilhada. A forma da planilha (onde fica o
 * cabecalho, como vem a data) segue o formato do Excel e o que os bancos
 * costumam exportar - e e a parte que precisa de um arquivo de verdade para
 * deixar de ser palpite informado.
 */

/** Quantas linhas olhar atras do cabecalho. Preambulo de banco tem ~10. */
const LINHAS_PARA_ACHAR_CABECALHO = 40;

/**
 * Faixa em que um numero na coluna de data e, com certeza, data do Excel.
 *
 * 20000 e maio de 1954 e 80000 e janeiro de 2119. Fora disso, o numero e
 * outra coisa - e converter um "20260916" escrito como numero em data do
 * Excel daria o ano 57.000. Melhor deixar `parseDate` recusar e avisar.
 */
const SERIAL_MIN = 20_000;
const SERIAL_MAX = 80_000;

/**
 * Numero de serie do Excel para `YYYY-MM-DD`.
 *
 * A origem e 30/12/1899, e nao 01/01/1900, por causa de um erro antigo do
 * Lotus 1-2-3 que o Excel copiou de proposito: ele conta um 29/02/1900 que
 * nao existiu. Comecar dois dias antes compensa, para toda data depois de
 * marco de 1900 - que e toda data de fatura.
 *
 * Planilha gravada no Excel antigo de Mac usa outra origem (1904), e ler uma
 * como a outra deslocaria toda a fatura em quatro anos sem erro nenhum.
 *
 * A conta e em UTC e devolve texto, pelo mesmo motivo de `parseDate`: em fuso
 * negativo, `new Date` local voltaria um dia.
 */
export function excelSerialToIso(serial: number, date1904 = false): string {
  const origem = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(origem + Math.floor(serial) * 86_400_000);
  const ano = d.getUTCFullYear();
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function texto(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).trim();
}

interface Tabela {
  sheet: SheetData;
  /** Indice da linha do cabecalho na grade. */
  headerIndex: number;
  headers: string[];
  dateHeader: string;
  cardHeader: string | null;
}

/** A primeira linha da aba em que a deteccao do CSV acha as tres colunas. */
function acharTabela(sheet: SheetData): Tabela | null {
  const limite = Math.min(sheet.grid.length, LINHAS_PARA_ACHAR_CABECALHO);
  for (let i = 0; i < limite; i += 1) {
    const linha = sheet.grid[i] ?? [];
    const rotulos = linha.map(texto);
    if (rotulos.filter((r) => r !== "").length < 3) continue;

    const colunas = detectColumns(rotulos.filter((r) => r !== ""));
    if (colunas.date && colunas.description && colunas.amount) {
      return {
        sheet,
        headerIndex: i,
        headers: rotulos,
        dateHeader: colunas.date,
        cardHeader: colunas.card,
      };
    }
  }
  return null;
}

/**
 * Le a fatura da primeira aba que tem uma tabela de lancamentos.
 *
 * Varias abas sao comuns - "Resumo", "Lancamentos", "Limites" - e so uma tem
 * a tabela. A escolha e a primeira em que o cabecalho aparece, e as outras
 * sao ditas num aviso, para ninguem achar que o app leu o arquivo inteiro.
 */
export function parseSheet(
  sheets: readonly SheetData[],
  options: ParseOptions,
): ParseResult {
  const tabelas = sheets
    .map(acharTabela)
    .filter((t): t is Tabela => t !== null);

  const tabela = tabelas[0];
  if (!tabela) {
    // Deixa `buildDrafts` produzir o erro de coluna faltando, com o texto que
    // a tela ja sabe mostrar - e acrescenta o que so aqui se sabe: onde se
    // procurou.
    const primeira = sheets[0]?.grid.find((l) => l.some((c) => texto(c) !== "")) ?? [];
    const result = buildDrafts([], primeira.map(texto), options);
    result.format = "xlsx";
    result.issues.unshift({
      level: "error",
      message: `Não achei a tabela de lançamentos nas primeiras ${LINHAS_PARA_ACHAR_CABECALHO} linhas de ${
        sheets.length === 1 ? "a aba" : `nenhuma das ${sheets.length} abas`
      }. Procuro uma linha com data, descrição e valor lado a lado.`,
    });
    return result;
  }

  // Cabecalho vazio vira "Coluna N": sem nome, a coluna nao poderia ser
  // escolhida a mao na tela, que identifica coluna pelo rotulo. E nome
  // repetido ganha numero, porque a linha vira objeto por rotulo e duas
  // colunas "Valor" se sobrescreveriam - justamente o caso da fatura com
  // valor em dolar e em real lado a lado.
  const vistos = new Map<string, number>();
  const headers = tabela.headers.map((h, i) => {
    const base = h || `Coluna ${i + 1}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const date1904 = tabela.sheet.date1904 === true;

  const rows: Record<string, unknown>[] = [];
  for (const linha of tabela.sheet.grid.slice(tabela.headerIndex + 1)) {
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const cell = linha[i] ?? null;
      if (
        h === tabela.dateHeader &&
        typeof cell === "number" &&
        cell >= SERIAL_MIN &&
        cell <= SERIAL_MAX
      ) {
        row[h] = excelSerialToIso(cell, date1904);
      } else if (h === tabela.cardHeader && typeof cell === "number") {
        // O FINAL DO CARTAO PERDE O ZERO. Guardado como numero, "0162" vira
        // 162 - e o cartao 0162, o da casa, nunca casaria com o cadastrado:
        // todo lancamento dele entraria sem cartao. Final de cartao tem
        // sempre quatro digitos, entao o zero que falta so pode ser o da
        // esquerda.
        //
        // MEDIDO pelo teste de equivalencia com a fatura real do Itau: era a
        // UNICA diferenca entre ler a fatura em CSV e em planilha.
        row[h] = String(Math.trunc(cell)).padStart(4, "0");
      } else {
        // Numero continua numero: `parseAmount` aceita numero direto, e
        // passar por texto arriscaria "1023.5" virar milhar.
        row[h] = cell === null ? "" : cell;
      }
    });
    rows.push(row);
  }

  const result = buildDrafts(rows, headers, options);
  result.format = "xlsx";

  if (tabelas.length > 1 || sheets.length > 1) {
    result.issues.unshift({
      level: "info",
      message: `Li a aba "${tabela.sheet.name}"${
        sheets.length > 1 ? ` (de ${sheets.length})` : ""
      }, a partir da linha ${tabela.headerIndex + 1}.`,
    });
  } else if (tabela.headerIndex > 0) {
    result.issues.unshift({
      level: "info",
      message: `A tabela começa na linha ${tabela.headerIndex + 1}; as de cima eram o cabeçalho do banco.`,
    });
  }

  return result;
}
