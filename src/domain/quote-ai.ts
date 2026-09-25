import { z } from "zod";
import { parseAmountCents, toCents, type Cents } from "@/lib/money";
import type { MoneyCandidate, QuoteProposal } from "./quote-pdf";

/**
 * Ler o orcamento com IA (secao 15).
 *
 * POR QUE: o leitor por regra (`quote-pdf.ts`) errou quatro vezes nos
 * orcamentos reais de quem usa - telefone lido como R$ 99.023, o ano da data
 * por extenso como R$ 2.026, "N° 938" como R$ 938, a cidade como fornecedor -
 * e nao le foto nem PDF escaneado, que e como muito orcamento de obra chega.
 *
 * A DIFERENCA QUE MUDA TUDO: o leitor por regra ESCOLHE entre numeros que
 * estao no documento; ele erra, mas nunca inventa. Um modelo de linguagem
 * pode devolver um numero que nao esta escrito em lugar nenhum. Por isso a
 * resposta volta CONFERIDA contra o texto do documento, quando ha texto, e o
 * resultado diz o que foi possivel conferir:
 *
 *   - "alta"  - o valor esta escrito no documento;
 *   - "media" - lido de uma imagem, sem texto para conferir;
 *   - "baixa" - ha texto e o valor NAO esta nele. Pode ser soma que o modelo
 *               fez, pode ser invencao. A tela avisa, e a pessoa decide.
 *
 * Nada disto grava. Como no leitor por regra, o resultado preenche o
 * formulario, e quem confirma e a pessoa.
 */

/**
 * O pedido ao modelo.
 *
 * Em portugues porque o documento e em portugues, e cada regra abaixo e um
 * erro que o leitor por regra ja cometeu num orcamento de verdade - o modelo
 * recebe a lista do que nao fazer escrita, e nao deduzida.
 */
export const QUOTE_PROMPT = `Você lê orçamentos de fornecedores brasileiros (obra, reforma, material de construção, serviços) e extrai três informações.

Responda APENAS com um objeto JSON, sem texto antes ou depois, neste formato:
{"fornecedor": string ou null, "total": número ou null, "data": "AAAA-MM-DD" ou null, "outros_valores": [{"valor": número, "rotulo": string}]}

Regras:
- "total" é o valor final que o cliente paga pela proposta inteira, já com desconto. Se houver preço à vista e parcelado, o à vista vai em "total" e o parcelado em "outros_valores".
- Valores em reais como número JSON com ponto decimal: R$ 1.234,56 vira 1234.56.
- NUNCA use como valor: telefone, CNPJ, CPF, CEP, inscrição estadual, número do orçamento ou do pedido, ano, quantidade, metragem ou código de produto.
- "fornecedor" é a empresa que EMITIU o orçamento, não o cliente e não a cidade.
- "data" é a data de emissão do orçamento, não a validade nem a entrega.
- "outros_valores" traz no máximo 5 valores relevantes (subtotal, frete, desconto, parcelado), cada um com um rótulo curto.
- Se não encontrar uma informação, use null. Não invente.`;

/** O que se espera de volta. Folgado nos tipos: modelo escreve numero como texto. */
const RespostaSchema = z.object({
  fornecedor: z.string().nullable().optional(),
  total: z.union([z.number(), z.string()]).nullable().optional(),
  data: z.string().nullable().optional(),
  outros_valores: z
    .array(
      z.object({
        valor: z.union([z.number(), z.string()]),
        rotulo: z.string().optional(),
      }),
    )
    .nullable()
    .optional(),
});

/** Teto de sanidade. Orcamento de obra de casa nao passa de dez milhoes. */
const MAX_CENTS = 1_000_000_000;

/**
 * Numero vindo do modelo, em centavos.
 *
 * Aceita numero JSON (o pedido) e texto (o que modelo as vezes devolve mesmo
 * assim, "1.234,56"). Texto passa pelo mesmo `parseAmountCents` do resto do
 * app, que ja sabe desempatar ponto e virgula.
 */
function centavos(valor: number | string | null | undefined): Cents | null {
  if (valor === null || valor === undefined) return null;
  const cents = typeof valor === "number" ? toCents(valor) : parseAmountCents(valor);
  if (cents === null || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

/**
 * O objeto JSON de dentro da resposta.
 *
 * O pedido e "so JSON", e mesmo assim modelo embrulha em cerca de codigo, ou
 * poe uma frase antes. Pega do primeiro "{" ao ultimo "}": o objeto pedido nao
 * tem chave aninhada que confunda isso, e texto em volta nao e erro de leitura.
 */
function extrairJson(texto: string): unknown {
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;
  try {
    return JSON.parse(texto.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

function dataValida(data: string | null | undefined): string | null {
  if (!data) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.trim());
  if (!m) return null;
  const [, a, mes, d] = m;
  const probe = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  // Rejeita 31 de fevereiro, que o modelo pode devolver com toda a confianca.
  if (probe.getUTCMonth() !== Number(mes) - 1 || probe.getUTCDate() !== Number(d)) return null;
  // Orcamento do seculo passado ou de daqui a dez anos e leitura errada.
  const ano = Number(a);
  if (ano < 2000 || ano > new Date().getUTCFullYear() + 1) return null;
  return `${a}-${mes}-${d}`;
}

/**
 * Todos os valores que o documento traz escritos, em centavos.
 *
 * FOLGADO DE PROPOSITO: aqui nao se decide qual e o total - isso o modelo fez
 * -, so se pergunta "este numero esta escrito no papel?". Entra todo numero,
 * inclusive inteiro sem centavos, porque "R$ 4.000" e "4000" sao o mesmo
 * valor escrito de dois jeitos. A pergunta e se o modelo inventou, e nao se
 * acertou.
 */
export function amountsInText(texto: string): Set<Cents> {
  const saida = new Set<Cents>();
  for (const m of texto.matchAll(/\d[\d.,]*\d|\d/g)) {
    const cents = parseAmountCents(m[0]);
    if (cents !== null && cents > 0) saida.add(cents);
  }
  return saida;
}

export type QuoteSource = "texto" | "imagem";

/**
 * A resposta do modelo, conferida, no formato que o formulario ja entende.
 *
 * Devolve `null` quando a resposta nao tem JSON legivel - quem chama cai no
 * leitor por regra, que e melhor que um formulario vazio.
 *
 * `documento` e o texto do PDF, quando a leitura foi por texto. Com ele, cada
 * valor e conferido; sem ele (foto, PDF escaneado), nada ha para conferir, e
 * o resultado diz isso.
 */
export function parseQuoteAnswer(
  resposta: string,
  origem: QuoteSource,
  documento?: string,
): QuoteProposal | null {
  const bruto = extrairJson(resposta);
  const lido = RespostaSchema.safeParse(bruto);
  if (!lido.success) return null;

  const escritos = origem === "texto" && documento ? amountsInText(documento) : null;

  function candidato(cents: Cents, rotulo: string): MoneyCandidate {
    if (escritos === null) {
      return { cents, context: `${rotulo} · lido da imagem, confira`, confidence: "media" };
    }
    return escritos.has(cents)
      ? { cents, context: rotulo, confidence: "alta" }
      : {
          cents,
          context: `${rotulo} · não encontrei este valor escrito no documento`,
          confidence: "baixa",
        };
  }

  const totalCents = centavos(lido.data.total);
  const total = totalCents === null ? null : candidato(totalCents, "total");

  const vistos = new Set<Cents>(totalCents === null ? [] : [totalCents]);
  const alternatives: MoneyCandidate[] = [];
  for (const outro of lido.data.outros_valores ?? []) {
    const cents = centavos(outro.valor);
    // Repetido do total, ou repetido entre si, nao e alternativa: e o mesmo
    // botao duas vezes.
    if (cents === null || vistos.has(cents)) continue;
    vistos.add(cents);
    alternatives.push(candidato(cents, outro.rotulo?.trim() || "outro valor"));
    if (alternatives.length === 5) break;
  }

  const fornecedor = lido.data.fornecedor?.trim() || null;

  return {
    total,
    alternatives,
    // Nome de fornecedor com mais de 80 letras e paragrafo, nao nome.
    supplier: fornecedor && fornecedor.length <= 80 ? fornecedor : null,
    quotedOn: dataValida(lido.data.data),
  };
}
