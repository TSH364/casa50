import type { Cell } from "@/domain/project-sheet";

/**
 * Abrir um .xlsx sem dependencia nenhuma.
 *
 * POR QUE ESCREVER ISTO EM VEZ DE INSTALAR: um .xlsx e um zip de XML, e o
 * navegador ja sabe descompactar (`DecompressionStream`) e ler XML
 * (`DOMParser`). As bibliotecas do ramo custam caro para o que fazem aqui - a
 * mais leve pesa 2,4 MB desempacotados, e a mais conhecida esta parada na
 * 0.18.5 com falhas conhecidas em aberto. Isto sao 120 linhas que rodam no
 * aparelho de quem usa, para uma planilha de obra de 40 KB.
 *
 * O ARQUIVO NAO SAI DO APARELHO, como na leitura de fatura e na de PDF: o que
 * chega ao servidor e o que a pessoa confirmou na tela, e nao a planilha.
 *
 * O QUE ISTO NAO LE, de proposito: formato de celula (uma data volta como o
 * numero de serie do Excel), formula (volta o ultimo valor calculado, que e o
 * que o Excel guarda), celula mesclada, imagem, comentario. Nada disso muda a
 * leitura de uma lista de compras, e cada um deles dobraria o arquivo.
 */

export interface SheetData {
  name: string;
  /** Linhas densas: coluna 0 = A, buracos preenchidos com `null`. */
  grid: Cell[][];
  /**
   * O livro conta datas a partir de 1904, e nao de 1900.
   *
   * E o padrao do Excel antigo de Mac. Uma data e so um numero de dias, e
   * ler um arquivo desses com a origem errada desloca todas as datas em
   * quatro anos sem erro nenhum - por isso a origem viaja junto da grade.
   */
  date1904?: boolean;
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

async function inflaRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  // Escrever sem esperar, e ler em seguida: o stream tem contrapressao, e
  // esperar a escrita antes de comecar a ler trava os dois lados.
  void writer.write(bytes).then(() => writer.close());

  const reader = ds.readable.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    partes.push(value);
    tamanho += value.length;
  }
  const saida = new Uint8Array(tamanho);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

/**
 * Descompacta o zip lendo o DIRETORIO CENTRAL, e nao os cabecalhos locais.
 *
 * A diferenca importa: quando o gravador usa "data descriptor" - e o Excel usa
 * em parte dos arquivos - o cabecalho local traz tamanho zero, e quem confia
 * nele extrai arquivos vazios sem erro nenhum. O diretorio central sempre tem
 * os tamanhos certos.
 */
async function abreZip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let fim = -1;
  // O fim do diretorio pode ter ate 65535 bytes de comentario depois; a busca
  // e de tras para frente porque o registro fica no fim do arquivo.
  for (let i = buffer.byteLength - 22; i >= 0 && i >= buffer.byteLength - 65557; i -= 1) {
    if (view.getUint32(i, true) === ASSINATURA_FIM) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error("não parece um arquivo .xlsx");

  const quantidade = view.getUint16(fim + 10, true);
  const inicioCentral = view.getUint32(fim + 16, true);
  if (quantidade === 0xffff || inicioCentral === 0xffffffff) {
    // ZIP64. Uma planilha de obra nao chega la, e adivinhar seria pior que
    // dizer que nao deu.
    throw new Error("planilha grande demais (ZIP64)");
  }

  const arquivos = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  let p = inicioCentral;

  for (let n = 0; n < quantidade; n += 1) {
    if (view.getUint32(p, true) !== ASSINATURA_CENTRAL) break;
    const metodo = view.getUint16(p + 10, true);
    const comprimido = view.getUint32(p + 20, true);
    const tamanhoNome = view.getUint16(p + 28, true);
    const tamanhoExtra = view.getUint16(p + 30, true);
    const tamanhoComentario = view.getUint16(p + 32, true);
    const offsetLocal = view.getUint32(p + 42, true);
    const nome = decoder.decode(bytes.subarray(p + 46, p + 46 + tamanhoNome));

    if (view.getUint32(offsetLocal, true) === ASSINATURA_LOCAL) {
      // Os tamanhos de nome e extra do cabecalho LOCAL podem diferir dos do
      // central - e a unica coisa que se le dele.
      const nomeLocal = view.getUint16(offsetLocal + 26, true);
      const extraLocal = view.getUint16(offsetLocal + 28, true);
      const inicio = offsetLocal + 30 + nomeLocal + extraLocal;
      const dados = bytes.subarray(inicio, inicio + comprimido);
      if (metodo === 0) arquivos.set(nome, dados);
      // A copia existe porque `subarray` devolve uma janela sobre o buffer
      // original, e o `DecompressionStream` so aceita um buffer proprio.
      else if (metodo === 8) arquivos.set(nome, await inflaRaw(new Uint8Array(dados)));
      // Outros metodos (bzip2, lzma) nao aparecem em xlsx de Excel nem de
      // Google Sheets; ignorar a entrada e melhor que quebrar o arquivo todo.
    }

    p += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  return arquivos;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

function texto(arquivos: Map<string, Uint8Array>, caminho: string): string | null {
  const bytes = arquivos.get(caminho);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

/** `Id` -> `Target` de um arquivo `.rels`, com o `xl/` da frente ja tirado. */
function lerRels(
  arquivos: Map<string, Uint8Array>,
  caminho: string,
): Map<string, string> {
  const saida = new Map<string, string>();
  const xml = texto(arquivos, caminho);
  if (xml === null) return saida;
  for (const r of [...parseXml(xml).getElementsByTagName("Relationship")]) {
    const id = r.getAttribute("Id");
    const alvo = r.getAttribute("Target");
    if (!id || !alvo) continue;
    // Endereco externo fica como esta; caminho interno vira relativo a `xl/`.
    saida.set(
      id,
      /^https?:\/\//i.test(alvo)
        ? alvo
        : alvo.replace(/^\/?xl\//, "").replace(/^\//, ""),
    );
  }
  return saida;
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML inválido");
  return doc;
}

/**
 * "BC" -> 55. Coluna em indice 0.
 *
 * Vem da referencia da celula ("R10") porque o Excel OMITE celula vazia: sem
 * ler a letra, uma linha que pula da coluna B para a P entraria deslocada, e o
 * preco de um item cairia na coluna da quantidade do outro.
 */
export function columnIndex(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** As `<si>` de sharedStrings, com o texto rico remontado. */
function lerTextosCompartilhados(doc: Document): string[] {
  return [...doc.getElementsByTagName("si")].map((si) =>
    [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""),
  );
}

function lerCelula(c: Element, compartilhados: readonly string[]): Cell {
  const tipo = c.getAttribute("t");
  if (tipo === "inlineStr") {
    return (
      [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("") ||
      null
    );
  }
  const v = c.getElementsByTagName("v")[0]?.textContent;
  if (v === undefined || v === null) return null;

  if (tipo === "s") return compartilhados[Number(v)] ?? null;
  if (tipo === "str" || tipo === "d") return v;
  if (tipo === "b") return v === "1" ? "VERDADEIRO" : "FALSO";
  // `e` e celula com erro (#N/D, #REF!). Devolver o texto do erro faria dele
  // um nome de item; vazio e a verdade.
  if (tipo === "e") return null;

  const numero = Number(v);
  return Number.isFinite(numero) ? numero : v;
}

/**
 * Onde cada `<hyperlink>` da aba aponta, por referencia de celula.
 *
 * MEDIDO: na planilha real, a coluna "Link" das loucas mostra "Abrir anúncio",
 * e o endereco do Mercado Livre mora nas relacoes da aba. Ler so a celula
 * importaria a palavra "Abrir anúncio" tres vezes e jogaria fora justamente o
 * que serve na hora de comprar.
 */
function lerLinks(doc: Document, rels: ReadonlyMap<string, string>): Map<string, string> {
  const saida = new Map<string, string>();
  for (const h of [...doc.getElementsByTagName("hyperlink")]) {
    const ref = h.getAttribute("ref");
    if (!ref) continue;
    const id =
      h.getAttribute("r:id") ??
      h.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      );
    // `tooltip` costuma trazer o mesmo endereco e serve de reserva quando a
    // relacao nao esta onde se espera.
    const alvo = (id ? rels.get(id) : null) ?? h.getAttribute("tooltip");
    if (alvo && /^https?:\/\//i.test(alvo)) saida.set(ref, alvo);
  }
  return saida;
}

function lerPlanilha(
  doc: Document,
  compartilhados: readonly string[],
  links: ReadonlyMap<string, string> = new Map(),
): Cell[][] {
  const grid: Cell[][] = [];
  for (const row of [...doc.getElementsByTagName("row")]) {
    // O indice vem do atributo `r`, e nao da ordem: linha inteiramente vazia
    // nao e gravada, e contar por posicao juntaria linhas distantes.
    const numero = Number(row.getAttribute("r") ?? grid.length + 1);
    const linha: Cell[] = [];
    for (const c of [...row.getElementsByTagName("c")]) {
      const ref = c.getAttribute("r");
      const i = ref ? columnIndex(ref) : linha.length;
      const valor = lerCelula(c, compartilhados);
      const link = ref ? links.get(ref) : undefined;
      // O ENDERECO VENCE O ROTULO. "Abrir anúncio" e como a celula se apresenta,
      // nao o que ela guarda; quando a propria celula ja e um endereco, nada
      // muda.
      linha[i] =
        link && !(typeof valor === "string" && /^https?:\/\//i.test(valor))
          ? link
          : valor;
    }
    for (let i = 0; i < linha.length; i += 1) {
      if (linha[i] === undefined) linha[i] = null;
    }
    grid[numero - 1] = linha;
  }
  for (let i = 0; i < grid.length; i += 1) {
    if (grid[i] === undefined) grid[i] = [];
  }
  return grid;
}

// ---------------------------------------------------------------------------
// A entrada
// ---------------------------------------------------------------------------

/** Abre a planilha e devolve as abas na ordem em que aparecem no arquivo. */
export async function readWorkbook(buffer: ArrayBuffer): Promise<SheetData[]> {
  const arquivos = await abreZip(buffer);

  const workbook = texto(arquivos, "xl/workbook.xml");
  if (workbook === null) throw new Error("não parece um arquivo .xlsx");
  const wb = parseXml(workbook);

  const alvos = lerRels(arquivos, "xl/_rels/workbook.xml.rels");

  const pr = wb.getElementsByTagName("workbookPr")[0];
  const date1904 = /^(1|true)$/i.test(pr?.getAttribute("date1904") ?? "");

  const ssXml = texto(arquivos, "xl/sharedStrings.xml");
  const compartilhados = ssXml === null ? [] : lerTextosCompartilhados(parseXml(ssXml));

  const saida: SheetData[] = [];
  for (const sheet of [...wb.getElementsByTagName("sheet")]) {
    const nome = sheet.getAttribute("name") ?? `Planilha ${saida.length + 1}`;
    const id =
      sheet.getAttribute("r:id") ??
      sheet.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      );
    const alvo = id ? alvos.get(id) : undefined;
    if (alvo === undefined) continue;
    const xml = texto(arquivos, `xl/${alvo}`);
    if (xml === null) continue;

    const doc = parseXml(xml);
    // As relacoes da ABA, e nao as do livro: e ali que mora o endereco de cada
    // `<hyperlink>`. O caminho segue a convencao do formato - `a/b.xml` tem as
    // suas em `a/_rels/b.xml.rels`.
    const pasta = alvo.includes("/") ? alvo.slice(0, alvo.lastIndexOf("/") + 1) : "";
    const arquivo = alvo.slice(pasta.length);
    const links = lerLinks(doc, lerRels(arquivos, `xl/${pasta}_rels/${arquivo}.rels`));

    saida.push({ name: nome, grid: lerPlanilha(doc, compartilhados, links), date1904 });
  }

  if (saida.length === 0) throw new Error("a planilha não tem nenhuma aba legível");
  return saida;
}
