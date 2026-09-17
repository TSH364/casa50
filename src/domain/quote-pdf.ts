import type { Cents } from "@/lib/money";

/**
 * Ler o PDF de uma proposta e PROPOR o que preencher (secao 15).
 *
 * Esta funcao recebe TEXTO, e nao arquivo: a extracao do PDF acontece no
 * navegador (ver `components/project/quote-pdf-input.tsx`), e aqui fica so a
 * leitura do que estava escrito. Separados assim, a parte dificil - decidir
 * qual dos oito numeros da pagina e o total - tem teste, e a parte chata -
 * abrir o arquivo - nao precisa.
 *
 * O QUE ISTO NAO E: nao e importacao. Nada entra sozinho. A funcao devolve
 * um palpite com o nivel de confianca junto, e a tela preenche o formulario
 * para a pessoa conferir e corrigir. Orcamento de fornecedor nao tem formato:
 * cada um escreve como quer, e um app que gravasse sozinho o numero errado
 * seria pior do que um que nao le PDF nenhum.
 *
 * NAO MEDIDO CONTRA PDF REAL ainda. As regras abaixo saem de como orcamento
 * brasileiro costuma ser escrito, nao de uma amostra da caixa de entrada de
 * quem vai usar. Isso esta dito aqui de proposito: o resto deste projeto
 * mede antes de escrever regra, e esta e a excecao que ainda precisa de
 * dados de verdade para deixar de ser palpite informado.
 */

/** O que o pdfjs entrega de cada pedaco de texto da pagina. */
export interface PdfTextItem {
  str: string;
  /** Matriz de posicao; o indice 5 e o Y do pedaco na pagina. */
  transform?: number[];
}

/**
 * Remonta as LINHAS da pagina a partir dos pedacos soltos do pdfjs.
 *
 * E a parte de que tudo o mais depende: no papel, a palavra "total" e o
 * numero dela estao na mesma linha, e essa vizinhanca e a unica evidencia que
 * o resto deste arquivo tem. Entregue como texto corrido, o "TOTAL" do
 * cabecalho da tabela qualificaria o primeiro item, e a leitura erraria todo
 * orcamento que tem tabela - ou seja, quase todos.
 *
 * O Y e arredondado numa faixa porque a mesma linha visual nao vem com Y
 * identico: fonte maior numa celula desloca a base em fracao de ponto.
 *
 * VERIFICADO contra um PDF de verdade (tabela com itens, subtotal, desconto e
 * total), nao so contra texto sintetico: as quinze linhas sairam na ordem e
 * o total foi lido da linha certa.
 */
export function linesFromTextItems(items: readonly PdfTextItem[]): string {
  const porLinha = new Map<number, string[]>();
  for (const item of items) {
    if (typeof item.str !== "string" || item.str.trim() === "") continue;
    const y = Math.round((item.transform?.[5] ?? 0) / 3);
    const lista = porLinha.get(y) ?? [];
    lista.push(item.str);
    porLinha.set(y, lista);
  }
  return [...porLinha.entries()]
    // No PDF o Y cresce para CIMA: a ordem de leitura e do maior para o menor.
    .sort((a, b) => b[0] - a[0])
    .map(([, partes]) => partes.join(" ").replace(/\s{2,}/g, " ").trim())
    .join("\n");
}

export type Confidence = "alta" | "media" | "baixa";

export interface MoneyCandidate {
  cents: Cents;
  /** O trecho da linha em que o valor apareceu, para a tela poder mostrar. */
  context: string;
  confidence: Confidence;
}

export interface QuoteProposal {
  /** Melhor palpite para o valor da proposta. */
  total: MoneyCandidate | null;
  /** Outros valores encontrados, do mais provavel ao menos. */
  alternatives: MoneyCandidate[];
  supplier: string | null;
  /** Data do documento, em ISO, quando encontrada. */
  quotedOn: string | null;
}

/**
 * Valor em reais dentro de um texto.
 *
 * Aceita as duas grafias que aparecem na pratica: "11.800,00" (pt-BR) e
 * "11800.00" (planilha exportada sem formatar). O que separa as duas e qual
 * simbolo aparece por ULTIMO - em pt-BR a virgula fecha os centavos.
 */
const DINHEIRO = /(?:R\$\s*)?(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}|\d{3,})/g;

/** Converte o que o regex achou para centavos, respeitando a grafia. */
function paraCentavos(bruto: string): Cents | null {
  const limpo = bruto.replace(/[R$\s]/g, "");
  if (limpo === "") return null;

  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");

  let normalizado: string;
  if (ultimaVirgula > ultimoPonto) {
    // pt-BR: ponto e milhar, virgula e decimal.
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (ultimoPonto > ultimaVirgula) {
    normalizado = limpo.replace(/,/g, "");
  } else {
    // Sem separador decimal nenhum: numero inteiro de reais.
    normalizado = limpo;
  }

  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return Math.round(valor * 100);
}

/**
 * Palavras que, na linha, dizem "este e o numero que interessa".
 *
 * A ordem importa: "total geral" vence "total", que vence "valor". E
 * "subtotal" derruba, porque e justamente o numero que NAO e o fechamento -
 * numa proposta com tres blocos ha tres subtotais maiores que qualquer item
 * e menores que o total.
 */
const FORTE = /\b(total\s+geral|valor\s+total|total\s+do\s+or[cç]amento|total\s+a\s+pagar|pre[cç]o\s+total)\b/i;
const MEDIO = /\b(total|valor\s+final|investimento)\b/i;
const DERRUBA = /\b(subtotal|parcial|desconto|acr[eé]scimo|frete|entrada|sinal|parcela|por\s+m[eê]s|mensal|unit[aá]rio|por\s+unidade)\b/i;

/**
 * Datas saem da linha ANTES de procurar dinheiro.
 *
 * MEDIDO no proprio exemplo de teste: "Data: 14/09/2026" produzia um
 * candidato de R$ 2.026,00 - o ANO lido como valor - e ele aparecia na lista
 * de alternativas oferecida a pessoa. Numero fantasma numa tela de dinheiro
 * e pior que alternativa nenhuma.
 *
 * Retirar o trecho, e nao descartar a linha inteira, porque uma linha pode
 * trazer as duas coisas: "Orcamento de 14/09/2026 - Total 11.800,00".
 */
const DATA_NA_LINHA = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

/** Linhas que nao sao dinheiro apesar de terem numero com dois decimais. */
const NAO_E_DINHEIRO = /\b(cnpj|cpf|cep|telefone|fone|whats|ie\b|inscri[cç][aã]o|n[ºo°]\s*\d|or[cç]amento\s*n)\b/i;

/**
 * Todos os valores do texto, cada um com o quanto a linha dele convence.
 *
 * Por LINHA, e nao pelo texto corrido: num orcamento o que qualifica o numero
 * esta escrito ao lado dele, e juntar as linhas faria o "total" de um bloco
 * qualificar o valor do bloco seguinte.
 */
export function moneyCandidates(text: string): MoneyCandidate[] {
  const achados: MoneyCandidate[] = [];

  for (const linhaBruta of text.split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    if (linha === "" || NAO_E_DINHEIRO.test(linha)) continue;
    const semData = linha.replace(DATA_NA_LINHA, " ");

    const forte = FORTE.test(linha);
    const medio = !forte && MEDIO.test(linha);
    const derruba = DERRUBA.test(linha);

    for (const m of semData.matchAll(DINHEIRO)) {
      const cents = paraCentavos(m[1] ?? "");
      if (cents === null) continue;
      // Abaixo de um real quase sempre e numero de item, percentual ou
      // codigo - e uma proposta de obra nao custa R$ 0,50.
      if (cents < 100) continue;

      const confidence: Confidence = derruba
        ? "baixa"
        : forte
          ? "alta"
          : medio
            ? "media"
            : "baixa";

      achados.push({ cents, context: linha.slice(0, 120), confidence });
    }
  }

  return achados;
}

const PESO: Record<Confidence, number> = { alta: 3, media: 2, baixa: 1 };

/**
 * Qual dos valores e o total da proposta.
 *
 * Primeiro pela confianca da linha; empatou, o MAIOR vence. O maior sozinho
 * seria regra ruim - uma proposta que lista "valor do imovel" perderia - mas
 * como desempate entre linhas igualmente qualificadas ele acerta: o
 * fechamento de um orcamento e maior que os itens que o compoem.
 */
function melhor(candidatos: readonly MoneyCandidate[]): MoneyCandidate[] {
  return [...candidatos].sort(
    (a, b) => PESO[b.confidence] - PESO[a.confidence] || b.cents - a.cents,
  );
}

/**
 * De quem e a proposta.
 *
 * O nome costuma estar no papel timbrado, no alto. A pista mais confiavel e o
 * CNPJ: a razao social fica logo acima ou na mesma linha dele. Sem CNPJ,
 * sobra a primeira linha que pareca nome - e o palpite fica fraco, que e por
 * isso que a tela deixa editar.
 */
export function supplierFrom(text: string): string | null {
  const linhas = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

  const iCnpj = linhas.findIndex((l) => /\bcnpj\b/i.test(l));
  if (iCnpj >= 0) {
    // Na mesma linha, o que vem antes de "CNPJ" costuma ser a razao social.
    const antes = linhas[iCnpj]!.split(/\bcnpj\b/i)[0]?.trim();
    if (antes && antes.length >= 3) return limpar(antes);
    for (let i = iCnpj - 1; i >= 0 && i >= iCnpj - 3; i -= 1) {
      const c = linhas[i]!;
      if (pareceNome(c)) return limpar(c);
    }
  }

  for (const l of linhas.slice(0, 8)) {
    if (pareceNome(l)) return limpar(l);
  }
  return null;
}

function pareceNome(linha: string): boolean {
  if (linha.length < 3 || linha.length > 80) return false;
  // Linha que e so numero, data, dinheiro ou rotulo nao e nome de empresa.
  if (/^[\d\s.,\-/:]+$/.test(linha)) return false;
  if (/^(or[cç]amento|proposta|data|validade|cliente|obra|endere[cç]o)\b/i.test(linha)) {
    return false;
  }
  if (NAO_E_DINHEIRO.test(linha)) return false;
  return /[A-Za-zÀ-ÿ]{3}/.test(linha);
}

function limpar(nome: string): string {
  return nome.replace(/[-–—:|]+$/, "").replace(/\s{2,}/g, " ").trim().slice(0, 120);
}

/** Data do documento: a primeira dd/mm/aaaa que nao seja de validade. */
export function quotedOnFrom(text: string): string | null {
  for (const linhaBruta of text.split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    // "Validade: 30/10/2026" é quando vence, não quando foi feito.
    if (/\bvalidade|v[aá]lido\s+at[eé]|vencimento\b/i.test(linha)) continue;
    const m = linha.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (m) {
      const [, d, mes, ano] = m;
      const dia = Number(d), mm = Number(mes);
      if (dia >= 1 && dia <= 31 && mm >= 1 && mm <= 12) {
        return `${ano}-${mes}-${d}`;
      }
    }
  }
  return null;
}

/** O que a tela deve preencher a partir do texto do PDF. */
export function readQuote(text: string): QuoteProposal {
  const ordenados = melhor(moneyCandidates(text));
  // Sem repetir o mesmo valor: uma proposta costuma imprimir o total duas
  // vezes (no corpo e no rodape), e oferecer o mesmo numero duas vezes na
  // lista de alternativas nao ajuda ninguem a escolher.
  const unicos: MoneyCandidate[] = [];
  for (const c of ordenados) {
    if (!unicos.some((u) => u.cents === c.cents)) unicos.push(c);
  }

  return {
    total: unicos[0] ?? null,
    alternatives: unicos.slice(1, 6),
    supplier: supplierFrom(text),
    quotedOn: quotedOnFrom(text),
  };
}
