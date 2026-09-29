import { z } from "zod";
import type { Cents } from "@/lib/money";
import { numbersIn } from "./ai-insights";
import { addMonths } from "./month";
import type { MonthKey } from "./types";

/**
 * A pesquisa de compra da Conversa (secao 16).
 *
 * "Quero comprar uma air fryer" vira uma busca na web - so com o nome do
 * produto, nunca com dado da casa - e as ofertas voltam num cartao com os
 * links. Duas conferencias antes de uma oferta chegar a tela:
 *
 *   - O LINK tem de ser uma pagina que a busca abriu de fato (as citacoes do
 *     OpenRouter). Link escrito pelo modelo e nao visitado nao aparece: pode
 *     nao existir, ou ser de outro produto.
 *   - O PRECO e conferido contra o trecho da pagina. Nao bateu, a oferta
 *     continua (o trecho pode ter cortado o preco), mas o cartao avisa para
 *     conferir na loja. Preco de pagina muda; o cartao diz sempre de quando e.
 */

export interface Offer {
  title: string;
  store: string;
  priceCents: Cents;
  /** "10x de R$ 49,90 sem juros", como a pagina diz. */
  installments: string | null;
  url: string;
  /** O preco apareceu no trecho da pagina que a busca trouxe. */
  priceSeen: boolean;
}

export interface ShoppingSearch {
  id: string;
  query: string;
  maxPriceCents: Cents | null;
  offers: Offer[];
  /** ISO: quando a busca rodou. */
  searchedAt: string;
}

export interface Citation {
  url: string;
  title: string;
  content: string;
}

const MAX_OFERTAS = 6;

/** O pedido para a busca. So o produto e o teto - nada da casa. */
export function offersPrompt(query: string, maxPriceCents: Cents | null): string {
  return [
    `Pesquise ofertas à venda no Brasil, hoje, para: ${query}.`,
    maxPriceCents !== null ? `Preço máximo: R$ ${(maxPriceCents / 100).toFixed(2).replace(".", ",")}.` : "",
    "Priorize Mercado Livre, Amazon Brasil, Magazine Luiza, Casas Bahia, Kabum, Americanas e lojas oficiais das marcas. Só produtos novos, à venda, com preço na página.",
    `Responda SÓ com JSON, até ${MAX_OFERTAS} ofertas, sem texto antes ou depois:`,
    '{"ofertas":[{"titulo":"nome do produto como na página","loja":"nome da loja","preco":123.45,"parcelamento":"10x de R$ 12,35 sem juros ou vazio","url":"endereço da página do produto"}]}',
    '"preco" é o valor à vista em reais, como número. "url" tem de ser uma das páginas que você consultou.',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Endereco comparavel: sem www, sem consulta, sem ancora, sem barra no fim. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

const LOJAS: [RegExp, string][] = [
  [/(^|\.)mercadoli(vre|bre)\./, "Mercado Livre"],
  [/(^|\.)amazon\./, "Amazon"],
  [/(^|\.)magazineluiza\.|(^|\.)magalu\./, "Magalu"],
  [/(^|\.)casasbahia\./, "Casas Bahia"],
  [/(^|\.)pontofrio\./, "Ponto"],
  [/(^|\.)kabum\./, "Kabum"],
  [/(^|\.)americanas\./, "Americanas"],
  [/(^|\.)shopee\./, "Shopee"],
  [/(^|\.)carrefour\./, "Carrefour"],
  [/(^|\.)fastshop\./, "Fast Shop"],
];

/** O nome da loja pelo endereco - mais confiavel que o que o modelo escreveu. */
export function storeFromUrl(url: string, fallback: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [re, nome] of LOJAS) if (re.test(host)) return nome;
    return fallback.trim() || host.replace(/^www\./, "");
  } catch {
    return fallback.trim();
  }
}

const ofertaSchema = z.object({
  titulo: z.string().trim().min(2).transform((v) => v.slice(0, 160)),
  loja: z.string().trim().max(80).optional().default(""),
  preco: z.union([z.number(), z.string()]),
  parcelamento: z.string().trim().max(120).nullish(),
  url: z.string().trim().min(8).max(2000),
});

function precoEmCentavos(v: number | string): Cents | null {
  const n = typeof v === "number" ? v : numbersIn(v)[0] ?? Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n * 100);
}

function jsonDe(raw: string): unknown {
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(raw.slice(i, j + 1));
  } catch {
    return null;
  }
}

/**
 * As ofertas que passam: link visitado, preco valido, sem repetir pagina.
 * Da mais barata para a mais cara; acima do teto, fora.
 */
export function checkOffers(
  raw: string,
  citations: readonly Citation[],
  maxPriceCents: Cents | null,
): { offers: Offer[]; dropped: number } {
  const json = jsonDe(raw) as { ofertas?: unknown } | null;
  const lista = Array.isArray(json?.ofertas) ? json.ofertas : [];
  const visitadas = new Map<string, Citation>();
  for (const c of citations) {
    const k = normalizeUrl(c.url);
    if (k) visitadas.set(k, c);
  }

  const vistos = new Set<string>();
  const offers: Offer[] = [];
  let dropped = 0;
  for (const bruto of lista) {
    const o = ofertaSchema.safeParse(bruto);
    const k = o.success ? normalizeUrl(o.data.url) : null;
    const pagina = k ? visitadas.get(k) : undefined;
    const cents = o.success ? precoEmCentavos(o.data.preco) : null;
    if (!o.success || !k || !pagina || cents === null || vistos.has(k)) {
      dropped += 1;
      continue;
    }
    if (maxPriceCents !== null && cents > maxPriceCents) {
      dropped += 1;
      continue;
    }
    vistos.add(k);
    const reais = cents / 100;
    offers.push({
      title: o.data.titulo,
      store: storeFromUrl(pagina.url, o.data.loja),
      priceCents: cents,
      installments: o.data.parcelamento?.trim() || null,
      // O link que vai para a tela e o da citacao, nao o que o modelo escreveu.
      url: pagina.url,
      priceSeen: numbersIn(`${pagina.title} ${pagina.content}`).some((n) => Math.abs(n - reais) <= 1),
    });
  }
  offers.sort((a, b) => a.priceCents - b.priceCents);
  return { offers: offers.slice(0, MAX_OFERTAS), dropped: dropped + Math.max(0, offers.length - MAX_OFERTAS) };
}

// ---------------------------------------------------------------------------
// Simular a compra
// ---------------------------------------------------------------------------

/** As parcelas de um valor: a sobra de centavos vai na primeira, como nas lojas. */
export function installmentPlan(totalCents: Cents, count: number): Cents[] {
  const n = Math.max(1, Math.min(24, Math.trunc(count)));
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? totalCents - base * (n - 1) : base));
}

export interface ImpactMonth {
  month: MonthKey;
  /** Parcelas que ja caem neste mes, antes da compra. */
  committedCents: Cents;
  /** A parcela nova. */
  newCents: Cents;
}

/**
 * Mes a mes, o que ja esta assumido e quanto a compra acrescenta. A primeira
 * parcela cai na fatura do mes seguinte - e assim que o cartao cobra.
 */
export function purchaseImpact(
  totalCents: Cents,
  count: number,
  fromMonth: MonthKey,
  committed: ReadonlyMap<MonthKey, Cents>,
): ImpactMonth[] {
  return installmentPlan(totalCents, count).map((newCents, i) => {
    const month = addMonths(fromMonth, i + 1);
    return { month, committedCents: committed.get(month) ?? 0, newCents };
  });
}
