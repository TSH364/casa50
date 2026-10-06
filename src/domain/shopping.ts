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
  /**
   * "pagina": o anuncio que a busca abriu. "busca": a busca da loja pelo nome
   * do produto - quando a IA citou uma loja mas o anuncio nao foi conferido.
   * Link de busca nunca quebra; link de anuncio inventado, sim.
   */
  linkKind?: "pagina" | "busca";
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

/**
 * O que vai para o BUSCADOR: so o produto, em poucas palavras.
 *
 * O plugin de busca do OpenRouter manda o texto da mensagem do usuario direto
 * para a Exa. Quando essa mensagem era o pedido inteiro ("Pesquise ofertas...
 * Priorize Mercado Livre, Amazon... responda em JSON"), a busca achava artigos
 * sobre monitorar preco no Mercado Livre - e nenhum anuncio do produto.
 */
export function offersQuery(query: string): string {
  return `${query.replace(/\s+/g, " ").trim()} preço comprar Brasil`;
}

/**
 * O que vai para o MODELO, como mensagem de sistema: como ler os resultados e
 * em que formato responder. So o produto e o teto - nada da casa.
 */
export function offersInstructions(query: string, maxPriceCents: Cents | null): string {
  return [
    `Encontre ofertas à venda no Brasil, hoje, para: ${query.replace(/\s+/g, " ").trim()}.`,
    maxPriceCents !== null ? `Preço máximo: R$ ${(maxPriceCents / 100).toFixed(2).replace(".", ",")}.` : "",
    "Prefira Mercado Livre, Amazon Brasil, Magazine Luiza, Casas Bahia, Kabum, Americanas e lojas oficiais das marcas. Só produtos novos, à venda, com preço na página, e só o produto pedido (não acessório, refil ou peça).",
    `Responda SÓ com JSON, até ${MAX_OFERTAS} ofertas, sem texto antes ou depois:`,
    '{"ofertas":[{"titulo":"nome do produto como na página","loja":"nome da loja","preco":123.45,"parcelamento":"10x de R$ 12,35 sem juros ou vazio","url":"endereço da página do produto"}]}',
    '"preco" é o valor à vista em reais, como número. "url" tem de ser uma das páginas dos resultados da busca.',
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * O texto que acompanha os resultados da busca. Substitui o do OpenRouter,
 * que pede citacao em links markdown - e com ele o modelo responde em prosa.
 */
export const SEARCH_PROMPT =
  "Resultados de uma busca na web, feita agora. Use-os para responder exatamente no formato JSON pedido. O campo url de cada oferta tem de ser o endereço de um destes resultados, copiado como está.";

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

/**
 * O mesmo produto aparece com enderecos diferentes: a IA copia o da lista, a
 * busca cita o do anuncio; um tem o nome no caminho, o outro nao. O codigo do
 * produto e o que nao muda - MLB123 no Mercado Livre, o ASIN na Amazon.
 */
export function productKeys(raw: string): string[] {
  const k = normalizeUrl(raw);
  if (!k) return [];
  const chaves = [k];
  const ml = /MLB-?(\d{6,})/i.exec(k);
  if (ml) chaves.push(`mlb:${ml[1]}`);
  const amz = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(k);
  if (amz && /amazon\./.test(k)) chaves.push(`amz:${amz[1]!.toUpperCase()}`);
  const partes = k.split("/");
  const ultimo = partes[partes.length - 1];
  if (partes.length > 1 && ultimo && ultimo.length >= 6) chaves.push(`${partes[0]}|${ultimo}`);
  return chaves;
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
  const lista = Array.isArray(json?.ofertas) ? json.ofertas : ofertasDoTexto(raw);
  const visitadas = new Map<string, Citation>();
  for (const c of citations) for (const k of productKeys(c.url)) if (!visitadas.has(k)) visitadas.set(k, c);

  const vistos = new Set<string>();
  const offers: Offer[] = [];
  let dropped = 0;
  for (const bruto of lista) {
    const o = ofertaSchema.safeParse(bruto);
    const chaves = o.success ? productKeys(o.data.url) : [];
    const pagina = chaves.map((c) => visitadas.get(c)).find(Boolean);
    const k = pagina ? normalizeUrl(pagina.url) : null;
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

/**
 * Quando a IA responde em texto e nao em JSON: cada linha com um link e um
 * "R$" vira candidata. Passa pela mesma conferencia de link das outras.
 */
function ofertasDoTexto(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const linha of raw.split(/\n+/)) {
    const url = /\((https?:\/\/[^\s)]+)\)/.exec(linha)?.[1] ?? /(https?:\/\/[^\s)\]]+)/.exec(linha)?.[1];
    const preco = PRECO.exec(linha)?.[1];
    if (!url || !preco) continue;
    const titulo = (/\[([^\]]+)\]/.exec(linha)?.[1] ?? linha.replace(/https?:\/\/\S+/g, "").replace(PRECO, ""))
      .replace(/[*_#>`|-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ titulo: titulo || "Oferta", preco: `R$ ${preco}`, url });
  }
  return out;
}

/** A loja pelo endereco, so quando e uma das conhecidas. */
function lojaConhecida(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOJAS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

const PRECO = /R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/;
const PARCELAS = /(\d{1,2})\s?x\s?(?:de\s)?R\$\s?[\d.]+(?:,\d{2})?(?:\s?sem juros)?/i;

/**
 * Plano B: as ofertas direto das paginas citadas, quando a IA errou os links.
 *
 * So pagina de loja conhecida (blog e comparador citam preco de outra
 * coisa), e so com "R$" no trecho - o preco e o que a pagina mostrou, entao
 * `priceSeen` e verdadeiro por construcao.
 */
export function offersFromCitations(citations: readonly Citation[], maxPriceCents: Cents | null): Offer[] {
  const vistos = new Set<string>();
  const offers: Offer[] = [];
  for (const c of citations) {
    const store = lojaConhecida(c.url);
    const k = normalizeUrl(c.url);
    if (!store || !k || vistos.has(k)) continue;
    const m = PRECO.exec(`${c.title} ${c.content}`);
    const reais = m ? numbersIn(m[1]!)[0] ?? Number(m[1]) : Number.NaN;
    if (!Number.isFinite(reais) || reais <= 0 || reais > 1_000_000) continue;
    const cents = Math.round(reais * 100);
    if (maxPriceCents !== null && cents > maxPriceCents) continue;
    vistos.add(k);
    offers.push({
      title: (c.title || store).slice(0, 160),
      store,
      priceCents: cents,
      installments: PARCELAS.exec(c.content)?.[0] ?? null,
      url: c.url,
      priceSeen: true,
    });
  }
  return offers.sort((a, b) => a.priceCents - b.priceCents).slice(0, MAX_OFERTAS);
}

/** A busca da loja pelo nome do produto - endereco que sempre abre. */
export function storeSearchUrl(store: string, title: string): string | null {
  const q = title.replace(/\s+/g, " ").trim().slice(0, 100);
  if (q.length < 2) return null;
  const slug = q
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const enc = encodeURIComponent(q);
  switch (store) {
    case "Mercado Livre":
      return `https://lista.mercadolivre.com.br/${slug}`;
    case "Amazon":
      return `https://www.amazon.com.br/s?k=${enc}`;
    case "Magalu":
      return `https://www.magazineluiza.com.br/busca/${enc}/`;
    case "Kabum":
      return `https://www.kabum.com.br/busca/${slug}`;
    case "Americanas":
      return `https://www.americanas.com.br/busca/${slug}`;
    case "Shopee":
      return `https://shopee.com.br/search?keyword=${enc}`;
    default:
      return null;
  }
}

/**
 * Plano C: nada conferiu, mas a IA citou ofertas em lojas conhecidas. O
 * cartao mostra a loja e o preco que a IA viu, com o link de BUSCA na loja
 * pelo nome do produto (nunca o anuncio que ela escreveu, que pode nao
 * existir) - e avisa que o preco nao foi conferido.
 */
export function unverifiedOffers(raw: string, maxPriceCents: Cents | null): Offer[] {
  const json = jsonDe(raw) as { ofertas?: unknown } | null;
  const lista = Array.isArray(json?.ofertas) ? json.ofertas : ofertasDoTexto(raw);
  const vistos = new Set<string>();
  const offers: Offer[] = [];
  for (const bruto of lista) {
    const o = ofertaSchema.safeParse(bruto);
    if (!o.success) continue;
    const cents = precoEmCentavos(o.data.preco);
    if (cents === null || (maxPriceCents !== null && cents > maxPriceCents)) continue;
    const store = lojaConhecida(o.data.url) ?? LOJAS.find(([, nome]) => nome.toLowerCase() === o.data.loja.toLowerCase())?.[1] ?? null;
    const url = store ? storeSearchUrl(store, o.data.titulo) : null;
    if (!store || !url || vistos.has(url)) continue;
    vistos.add(url);
    offers.push({
      title: o.data.titulo,
      store,
      priceCents: cents,
      installments: o.data.parcelamento?.trim() || null,
      url,
      priceSeen: false,
      linkKind: "busca",
    });
  }
  return offers.sort((a, b) => a.priceCents - b.priceCents).slice(0, MAX_OFERTAS);
}

/**
 * O que a pesquisa viu, para o diagnostico em `ai_usage.details`: so
 * enderecos, titulos, tamanhos e o comeco da resposta. Nada da casa.
 */
export function searchDiagnostics(
  query: string,
  raw: string,
  citations: readonly Citation[],
  counts: { conferidas: number; descartadas: number; planoB: number; planoC: number },
): Record<string, unknown> {
  const host = (u: string) => {
    try {
      const x = new URL(u);
      return { h: x.hostname.replace(/^www\./, ""), p: x.pathname.slice(0, 80) };
    } catch {
      return { h: "?", p: u.slice(0, 80) };
    }
  };
  return {
    q: query.slice(0, 120),
    citacoes: citations.length,
    paginas: citations.slice(0, 10).map((c) => ({
      ...host(c.url),
      t: c.title.slice(0, 80),
      n: c.content.length,
      rs: /R\$/.test(c.content),
    })),
    resposta: raw.slice(0, 600),
    ...counts,
  };
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
