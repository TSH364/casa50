import { toCents, type Cents } from "@/lib/money";

/**
 * Ler a PLANILHA de um projeto e propor os itens (secao 15).
 *
 * Esta funcao recebe uma GRADE de celulas, e nao um arquivo: abrir o .xlsx
 * acontece no navegador (ver `lib/xlsx.ts`), e aqui fica so a parte dificil -
 * descobrir, no meio de titulo, cabecalho, subtotal e observacao, quais linhas
 * sao itens de verdade. Separados assim, a decisao tem teste e a leitura do
 * arquivo nao precisa de DOM nenhum.
 *
 * O QUE ISTO NAO E: nao e importacao. Nada entra sozinho. A funcao devolve
 * itens PROPOSTOS e a lista do que deixou de fora com o motivo, e a tela mostra
 * os dois antes de gravar. Planilha de obra nao tem formato: cada casa escreve
 * a sua, e um app que gravasse sozinho 15 itens errados seria pior que um app
 * que nao le planilha nenhuma.
 *
 * MEDIDO CONTRA A PLANILHA REAL de quem vai usar ("Acabamentos.xlsx", 6 abas,
 * 15 itens). Cada regra abaixo que parece arbitraria saiu de uma linha dela, e
 * o comentario diz qual. Antes de medir, eu teria escrito um leitor que
 * comecava em A1, tratava "SUBTOTAL revestimentos" como item de R$ 13.148 e
 * dava a um azulejo o nome "—".
 */

/** Uma celula como ela sai do arquivo: texto, numero, ou nada. */
export type Cell = string | number | null;
export type Grid = readonly (readonly Cell[])[];

/** Os campos que um item de projeto tem. `null` = nenhuma coluna serve. */
export interface ColumnMap {
  name: number | null;
  stage: number | null;
  unit: number | null;
  quantity: number | null;
  supplier: number | null;
  totalPrice: number | null;
  unitPrice: number | null;
  note: number | null;
  link: number | null;
}

export interface SheetItemRow {
  /** Linha na planilha, 1-based: e assim que a pessoa acha a linha de volta. */
  row: number;
  name: string;
  stage: string | null;
  unit: string | null;
  quantity: number | null;
  supplier: string | null;
  /** Preco da LINHA inteira, quando ha. Vira cotacao, nunca campo do item. */
  amountCents: Cents | null;
  note: string | null;
}

export interface SkippedRow {
  row: number;
  reason: string;
  text: string;
}

/** Uma coluna que poderia ser a quantidade, para a tela poder oferecer troca. */
export interface QuantityOption {
  column: number;
  label: string;
}

export interface SheetReading {
  items: SheetItemRow[];
  skipped: SkippedRow[];
  /** Colunas candidatas a quantidade, na ordem em que apareceram. */
  quantityOptions: QuantityOption[];
}

// ---------------------------------------------------------------------------
// Celulas
// ---------------------------------------------------------------------------

/**
 * Travessao sozinho e VAZIO, nao nome.
 *
 * MEDIDO: na planilha real, o azulejo da Eliane tem Produto = "—". Sem esta
 * regra o item se chamaria "—" e ninguem acharia o que e; com ela, o nome cai
 * para a marca e vira "Eliane".
 */
const VAZIO = /^[-–—\s]*$|^n\/?a$/i;

export function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  const texto = String(cell).trim();
  return VAZIO.test(texto) ? "" : texto;
}

function cellNumber(cell: Cell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const texto = cellText(cell);
  if (texto === "") return null;
  // Aceita "1.234,56" e "1234.56": planilha exportada de outro lugar mistura
  // as duas grafias na mesma coluna.
  const limpo = texto.replace(/[R$\s ]/gi, "");
  if (!/^-?[\d.,]+$/.test(limpo)) return null;
  const virgula = limpo.lastIndexOf(",");
  const ponto = limpo.lastIndexOf(".");
  const normal =
    virgula > ponto
      ? limpo.replace(/\./g, "").replace(",", ".")
      : limpo.replace(/,/g, "");
  const valor = Number(normal);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * Arredonda a sujeira de ponto flutuante que a planilha carrega.
 *
 * MEDIDO: a coluna "Qtd + perda" traz `69.454000000000008` e `4.3100000000000005`,
 * porque sao o resultado de `63,14 * 1,1` dentro do Excel. Gravar isso faria a
 * tela escrever "69,454000000000008 m²" ao lado de um item de obra.
 */
function limpaNumero(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sem(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Que tipo de linha e esta
// ---------------------------------------------------------------------------

/**
 * Palavras que so aparecem em cabecalho de tabela.
 *
 * "total" NAO esta aqui de proposito: "Custo estimado" e cabecalho, mas
 * "TOTAL GERAL DA COMPRA" e linha de soma, e as duas contem a palavra. Quem
 * separa as duas e o numero de celulas preenchidas, logo abaixo.
 */
const PALAVRA_DE_CABECALHO =
  /\b(marca|produto|item|descri\w*|especifica\w*|unid\w*|qtd|quantidade|pre[cç]o|valor|custo|status|etapa|ambiente|fornecedor|loja|link|comprar|tipo|ordem|respons\w*|[aá]rea|baldes?|rend\w*)\b/;

/** Linha de soma. Vem no comeco da linha, e e ai que se reconhece. */
const LINHA_DE_SOMA = /^(sub\s*)?total\b|^confer[eê]ncia\b|^soma\b/;

/** Observacao, nota de rodape, instrucao. Comeca com marcador ou dois-pontos. */
const LINHA_DE_NOTA = /^[•*·-]\s|^(obs|observa|nota|aten[cç][aã]o|legenda)/;

function preenchidas(row: readonly Cell[]): number {
  return row.reduce<number>((n, c) => n + (cellText(c) !== "" ? 1 : 0), 0);
}

function primeiroTexto(row: readonly Cell[]): string {
  for (const c of row) {
    const t = cellText(c);
    if (t !== "") return t;
  }
  return "";
}

/**
 * Cabecalho e a linha que NOMEIA colunas, e nao a que preenche.
 *
 * O SINAL QUE VALE E "NENHUM NUMERO", e nao a proporcao de palavras conhecidas.
 *
 * MEDIDO, e esta regra foi reescrita por causa disto: o cabecalho da lista de
 * compras real tem dezessete colunas, e oito delas sao nomes de comodo - Banho,
 * Cozinha, Lavabo, Quartos, Sala. Exigir que metade das celulas fosse palavra
 * de tabela dava 8 em 17, reprovava a linha por um voto, e as NOVE linhas de
 * revestimento e tinta abaixo dela caiam como "antes do cabecalho". Duas em
 * cada tres linhas da planilha sumiam em silencio.
 *
 * Numero, esse sim, cabecalho nao tem: quem escreve "Marca | Produto | Banho"
 * escreve texto na linha inteira, e quem escreve "Portinari | York | 2,5"
 * mistura. E o unico sinal que nao depende de adivinhar o vocabulario de quem
 * montou a planilha. As duas palavras conhecidas continuam exigidas para uma
 * lista de nomes soltos ("Marmore | Espelho | Forro") nao virar cabecalho.
 */
function ehCabecalho(row: readonly Cell[]): boolean {
  const textos = row.map(cellText).filter((t) => t !== "");
  if (textos.length < 3) return false;
  if (row.some((c) => cellNumber(c) !== null)) return false;
  const rotulos = textos.filter(
    (t) => PALAVRA_DE_CABECALHO.test(sem(t)) && !/^\d/.test(t),
  ).length;
  return rotulos >= 2;
}

/**
 * Titulo de secao: uma celula so, escrita para o olho humano.
 *
 * MEDIDO: "1. REVESTIMENTOS — comprar por m²" e "4. LOUÇAS, METAIS E
 * ACESSÓRIOS — comprar por unidade" dividem a aba da planilha real em blocos,
 * e cada bloco tem o seu proprio cabecalho. Ler isso como etapa e de graca: a
 * pessoa ja organizou a obra, e o app so precisa nao jogar fora.
 */
function tituloDeSecao(row: readonly Cell[]): string | null {
  if (preenchidas(row) !== 1) return null;
  const texto = primeiroTexto(row);
  if (texto.length < 3 || texto.length > 80) return null;
  if (LINHA_DE_NOTA.test(sem(texto))) return null;
  if (LINHA_DE_SOMA.test(sem(texto))) return null;
  if (texto.endsWith(":")) return null;
  return texto;
}

/**
 * "1. REVESTIMENTOS — comprar por m²" vira "Revestimentos".
 *
 * O numero e a explicacao depois do travessao servem a quem le a planilha;
 * como etapa, so atrapalhariam o agrupamento da tela.
 */
export function stageFromTitle(title: string): string {
  const semNumero = title.replace(/^\s*\d+[.)]\s*/, "");
  const antesDoTracao = semNumero.split(/\s+[—–-]\s+/)[0] ?? semNumero;
  const limpo = antesDoTracao.trim();
  if (limpo === "") return title.trim();
  // TUDO EM MAIUSCULA vira Capitalizado: o grito e formatacao de planilha, e
  // repetido em toda etapa da tela viraria ruido.
  if (limpo === limpo.toUpperCase()) {
    return limpo
      .toLocaleLowerCase("pt-BR")
      .replace(/^./, (c) => c.toLocaleUpperCase("pt-BR"));
  }
  return limpo;
}

// ---------------------------------------------------------------------------
// Que coluna e cada coisa
// ---------------------------------------------------------------------------

/**
 * A ordem das alternativas E a regra de desempate, e cada preferencia custou
 * uma linha da planilha real:
 *
 *   - `name` prefere "Item" a "Descricao". Na aba "Comprar" as duas existem:
 *     "Tanque inox 40x40" e o nome, e "Inox 304 fosco, 40x40x22cm, ~22-25L..."
 *     e a especificacao para mostrar na loja. Trocar as duas daria uma lista
 *     de itens ilegivel no celular;
 *   - `quantity` prefere "COMPRAR" a "Qtd projeto". A aba tem TRES colunas de
 *     quantidade - a do projeto, a com perda e a arredondada para comprar - e
 *     a unica que responde "comprei 40 dos 60" e a ultima. As outras ficam em
 *     `quantityOptions`, porque este desempate e palpite e a tela deixa trocar;
 *   - `totalPrice` prefere "Custo estimado" a "Preco unit.". Cotacao e o preco
 *     da linha inteira; gravar o unitario daria um previsto de R$ 129 para
 *     R$ 8.965 de porcelanato.
 */
const REGRAS: { campo: keyof ColumnMap; padroes: RegExp[] }[] = [
  {
    campo: "name",
    padroes: [/^item\b/, /^produto/, /^especifica/, /^descri/, /^servi[cç]o/],
  },
  { campo: "stage", padroes: [/^ambiente/, /^etapa/, /^c[oô]modo/, /^local/] },
  { campo: "unit", padroes: [/^unid/, /^un\.?$/, /^medida/] },
  {
    campo: "quantity",
    padroes: [/^comprar/, /^qtd\b/, /^quantidade/, /^baldes\b/, /^m2\b|^m²/],
  },
  { campo: "supplier", padroes: [/^marca/, /^fornecedor/, /^loja/, /^empresa/] },
  {
    campo: "totalPrice",
    padroes: [/^custo/, /^total/, /^valor\s*(total)?$/, /^subtotal/],
  },
  { campo: "unitPrice", padroes: [/^pre[cç]o/, /^r\$\s*\//, /^valor\s*unit/] },
  { campo: "note", padroes: [/^descri/, /^especifica/, /^observa/, /^nota/] },
  { campo: "link", padroes: [/^link/, /^url|^an[uú]ncio/] },
];

/** Descobre o que cada coluna e, a partir da linha de cabecalho. */
export function mapColumns(header: readonly Cell[]): ColumnMap {
  const rotulos = header.map((c) => sem(cellText(c)));
  const mapa: ColumnMap = {
    name: null,
    stage: null,
    unit: null,
    quantity: null,
    supplier: null,
    totalPrice: null,
    unitPrice: null,
    note: null,
    link: null,
  };
  const usadas = new Set<number>();

  for (const { campo, padroes } of REGRAS) {
    for (const padrao of padroes) {
      const i = rotulos.findIndex(
        (r, idx) => r !== "" && !usadas.has(idx) && padrao.test(r),
      );
      if (i >= 0) {
        mapa[campo] = i;
        // Uma coluna serve a um campo so: sem isto, "Descricao" viraria nome E
        // observacao, e a tela repetiria o mesmo texto duas vezes na mesma
        // linha. A excecao e `unitPrice`, que pode nao ter concorrente.
        usadas.add(i);
        break;
      }
    }
  }
  return mapa;
}

/** Todas as colunas que poderiam ser quantidade, para a tela oferecer troca. */
function opcoesDeQuantidade(header: readonly Cell[]): QuantityOption[] {
  const padroes = REGRAS.find((r) => r.campo === "quantity")!.padroes;
  const saida: QuantityOption[] = [];
  header.forEach((c, i) => {
    const rotulo = cellText(c);
    if (rotulo === "" ) return;
    if (padroes.some((p) => p.test(sem(rotulo)))) {
      saida.push({ column: i, label: rotulo });
    }
  });
  return saida;
}

// ---------------------------------------------------------------------------
// A leitura
// ---------------------------------------------------------------------------

export interface ReadOptions {
  /** Coluna de quantidade escolhida a mao, quando o palpite nao serve. */
  quantityColumn?: number;
}

/**
 * Le a grade inteira e devolve os itens propostos.
 *
 * O estado que a varredura carrega e pequeno de proposito: a etapa corrente e
 * o mapa de colunas corrente. Os dois trocam no meio da aba, porque a planilha
 * real tem quatro blocos e o quarto tem colunas diferentes dos tres primeiros
 * - um mapa unico para a aba inteira daria a uma cuba de apoio o nome da sua
 * especificacao de tres linhas.
 */
export function readProjectSheet(grid: Grid, options: ReadOptions = {}): SheetReading {
  const items: SheetItemRow[] = [];
  const skipped: SkippedRow[] = [];
  const quantityOptions: QuantityOption[] = [];

  let colunas: ColumnMap | null = null;
  let etapa: string | null = null;

  grid.forEach((row, index) => {
    const linha = index + 1;
    if (preenchidas(row) === 0) return;

    const texto = primeiroTexto(row);

    if (ehCabecalho(row)) {
      colunas = mapColumns(row);
      for (const opcao of opcoesDeQuantidade(row)) {
        if (!quantityOptions.some((o) => o.column === opcao.column)) {
          quantityOptions.push(opcao);
        }
      }
      skipped.push({ row: linha, reason: "cabeçalho", text: texto });
      return;
    }

    if (LINHA_DE_SOMA.test(sem(texto))) {
      // A linha mais perigosa da planilha: "SUBTOTAL revestimentos" tem nome,
      // quantidade e R$ 13.148 preenchidos, e passaria por item em qualquer
      // leitor que so olhasse as celulas.
      skipped.push({ row: linha, reason: "linha de soma", text: texto });
      return;
    }

    if (LINHA_DE_NOTA.test(sem(texto)) || texto.endsWith(":")) {
      // A OBSERVACAO ENCERRA A TABELA. Depois de "Observacoes:" ou
      // "Conferencia - soma dos ambientes deve bater com o total:" nao vem mais
      // item nenhum: vem prosa e vem conta de conferencia.
      //
      // MEDIDO: sem isto, as tres linhas de conferencia do fim da planilha real
      // - "Revestimentos (m²) | 0 | OK" - entravam como itens, e uma delas ainda
      // ficava com unidade "0", porque caiam sob o cabecalho da secao de loucas,
      // que ja tinha acabado vinte linhas antes.
      colunas = null;
      skipped.push({ row: linha, reason: "observação", text: texto });
      return;
    }

    if (preenchidas(row) === 1) {
      // Uma celula sozinha e titulo de secao ou e prosa - nunca item, porque
      // item tem pelo menos nome e alguma coisa. O tamanho separa os dois.
      //
      // MEDIDO: "Área (verde) puxa da tabela Orçamento (Plan1) por marca+produto.
      // Preencha só o Rendimento do balde..." - 185 caracteres de instrucao numa
      // celula so - virava um item de obra com esse nome inteiro.
      const titulo = tituloDeSecao(row);
      if (titulo !== null) {
        etapa = stageFromTitle(titulo);
        skipped.push({ row: linha, reason: "título de seção", text: texto });
      } else {
        skipped.push({ row: linha, reason: "texto solto", text: texto });
      }
      return;
    }

    if (colunas === null) {
      skipped.push({ row: linha, reason: "antes do cabeçalho", text: texto });
      return;
    }

    const item = leItem(row, linha, colunas, etapa, options);
    if (item === null) {
      skipped.push({ row: linha, reason: "sem nome", text: texto });
      return;
    }
    items.push(item);
  });

  return { items, skipped, quantityOptions };
}

/**
 * Qual aba abrir primeiro, num arquivo de seis.
 *
 * MEDIDO na planilha real: ela tem "Plan1", "Lista Loja", "Resumo", "A Cotar",
 * "Cronograma" e "Comprar", e as seis sao legiveis. Abrir a primeira do arquivo
 * mostraria a "Plan1", que repete o mesmo porcelanato em quatro comodos e daria
 * quatro itens "York" - a "Lista Loja" e que e a lista de compras.
 *
 * A conta e NOME DISTINTO COM NUMERO: linha sem quantidade nem preco pode ser
 * cronograma, e nome repetido e a marca de aba por ambiente. Nao e certeza
 * nenhuma, so um primeiro palpite - a tela lista todas as abas com a contagem
 * de cada uma, e trocar e um toque.
 */
export function scoreSheet(reading: SheetReading): number {
  const nomes = new Set<string>();
  for (const item of reading.items) {
    if (item.quantity === null && item.amountCents === null) continue;
    nomes.add(sem(item.name));
  }
  return nomes.size;
}

function pega(row: readonly Cell[], coluna: number | null): string {
  return coluna === null ? "" : cellText(row[coluna] ?? null);
}

function pegaNumero(row: readonly Cell[], coluna: number | null): number | null {
  return coluna === null ? null : cellNumber(row[coluna] ?? null);
}

/**
 * Ultimo recurso para o nome: a coluna que nenhum campo reclamou.
 *
 * MEDIDO: em "ITENS NOVOS (ainda fora do orcamento)" a planilha real escreve
 * "— | Mármore | — | — | — | ⚠️ Falta cotar". O nome esta na coluna "Tipo", que
 * nao e nome, nem marca, nem quantidade - e sem esta saida os tres itens que a
 * casa ainda precisa cotar, justamente os que mais importam, sumiam calados.
 *
 * As duas travas existem para isto nao virar uma peneira: linha com muita
 * celula ja tem o seu nome no lugar certo, e texto longo e prosa, nao nome.
 */
function nomeDeColunaSobrando(row: readonly Cell[], colunas: ColumnMap): string {
  if (preenchidas(row) > 4) return "";
  const mapeadas = new Set(
    Object.values(colunas).filter((c): c is number => c !== null),
  );
  for (let i = 0; i < row.length; i += 1) {
    if (mapeadas.has(i)) continue;
    const texto = cellText(row[i] ?? null);
    if (texto !== "" && texto.length <= 60 && cellNumber(row[i] ?? null) === null) {
      return texto;
    }
  }
  return "";
}

function leItem(
  row: readonly Cell[],
  linha: number,
  colunas: ColumnMap,
  etapa: string | null,
  options: ReadOptions,
): SheetItemRow | null {
  const fornecedor = pega(row, colunas.supplier);

  // O nome cai para o fornecedor quando a coluna de nome esta vazia, porque na
  // planilha real "Eliane · —" e um azulejo de verdade, com metragem e preco.
  // Descartar a linha por causa de um travessao perderia R$ 626 de item.
  const nome = pega(row, colunas.name) || fornecedor || nomeDeColunaSobrando(row, colunas);
  if (nome === "") return null;

  const quantidadeBruta = pegaNumero(
    row,
    options.quantityColumn ?? colunas.quantity,
  );
  // Zero nao e quantidade: na planilha real as colunas por ambiente trazem 0
  // para todo ambiente que nao usa aquele material, e um item "0 m²" mentiria
  // dizendo que ja esta comprado.
  const quantity =
    quantidadeBruta !== null && quantidadeBruta > 0
      ? limpaNumero(quantidadeBruta)
      : null;

  const total = pegaNumero(row, colunas.totalPrice);
  const unitario = pegaNumero(row, colunas.unitPrice);
  // O total da linha vence; sem coluna de total, o unitario vezes a quantidade.
  // A conta e explicita porque a alternativa - gravar o unitario como se fosse
  // o total - erraria por um fator igual a metragem.
  const valor =
    total !== null && total > 0
      ? total
      : unitario !== null && unitario > 0 && quantity !== null
        ? unitario * quantity
        : null;

  const link = pega(row, colunas.link);
  const observacao = pega(row, colunas.note);
  // O link entra na observacao porque `project_items` nao tem campo de link, e
  // jogar fora o endereco do anuncio obrigaria a pessoa a voltar na planilha
  // justamente na hora de comprar.
  const note =
    [observacao, /^https?:\/\//i.test(link) ? link : ""]
      .filter((t) => t !== "")
      .join(" · ") || null;

  return {
    row: linha,
    name: nome,
    stage: pega(row, colunas.stage) || etapa,
    unit: pega(row, colunas.unit) || null,
    quantity,
    supplier: fornecedor || null,
    // `null` e nao zero: "ainda nao cotei" e diferente de "custa nada", e a
    // planilha real usa 0 exatamente para o que falta cotar.
    amountCents: valor !== null && valor > 0 ? toCents(valor) : null,
    note,
  };
}
