import type { Cents } from "@/lib/money";
import type { Offer } from "./shopping";

/**
 * Radar de produtos: o preco do que a casa quer comprar, acompanhado por dia.
 *
 * As regras puras ficam aqui; a busca (`lib/ofertas.ts`) e a gravacao
 * (`actions/radar.ts`) so as aplicam.
 */

export interface RadarProduto {
  id: string;
  nome: string;
  /** Quanto a casa aceita pagar. `null`: so avisa de queda. */
  metaCents: Cents | null;
  ativo: boolean;
  /** ISO da ultima conferencia que terminou (com ou sem preco). */
  conferidoEm: string | null;
  erro: string | null;
  melhor: { cents: Cents; loja: string; url: string; titulo: string | null } | null;
  /** A foto do anuncio (og:image da loja). `null` ate a primeira achada. */
  imagem: string | null;
  /** As outras lojas da ultima conferencia, da mais barata a mais cara. */
  outras: RadarOferta[];
}

export interface RadarOferta {
  loja: string;
  cents: Cents;
  url: string;
  vistoNaPagina: boolean;
}

/** Quantas outras lojas a tela mostra. */
export const MAX_OUTRAS = 4;

/**
 * As outras lojas que a mesma busca achou, para comparar.
 *
 * So anuncio (link de busca da loja nao tem preco conferivel), uma por loja
 * - a mais barata dela -, sem a loja da melhor oferta, da mais barata a mais
 * cara. So https.
 */
export function outrasOfertas(offers: readonly Offer[], melhor: Offer | null): RadarOferta[] {
  const porLoja = new Map<string, Offer>();
  for (const o of offers) {
    if (o.linkKind === "busca" || o.priceCents <= 0 || !o.url.startsWith("https://")) continue;
    const chave = o.store.trim().toLowerCase();
    if (melhor && chave === melhor.store.trim().toLowerCase()) continue;
    const atual = porLoja.get(chave);
    if (!atual || o.priceCents < atual.priceCents) porLoja.set(chave, o);
  }
  return [...porLoja.values()]
    .sort((a, b) => a.priceCents - b.priceCents)
    .slice(0, MAX_OUTRAS)
    .map((o) => ({ loja: o.store, cents: o.priceCents, url: o.url, vistoNaPagina: o.priceSeen }));
}

/** Le `last_offers` do banco sem confiar no formato: o que nao bate, cai. */
export function lerOutras(valor: unknown): RadarOferta[] {
  if (!Array.isArray(valor)) return [];
  const out: RadarOferta[] = [];
  for (const v of valor) {
    const o = v as Record<string, unknown>;
    const cents = Number(o?.cents);
    if (typeof o?.loja !== "string" || typeof o?.url !== "string" || !o.url.startsWith("https://")) continue;
    if (!Number.isFinite(cents) || cents <= 0) continue;
    out.push({ loja: o.loja, cents, url: o.url, vistoNaPagina: o.vistoNaPagina === true });
  }
  return out.slice(0, MAX_OUTRAS);
}

export interface RadarPreco {
  /** ISO. */
  em: string;
  cents: Cents;
  loja: string;
  url: string;
  titulo: string | null;
  vistoNaPagina: boolean;
}

/**
 * Uma vez por dia, com folga: quem abre o app todo dia as 8h nao pode cair
 * fora da janela por ter aberto as 7h50. 20 h basta para "uma vez por dia".
 */
export const HORAS_ENTRE_CONFERENCIAS = 20;

/** Por abertura do app, no maximo tantos produtos - cada busca leva ~15 s. */
export const MAX_POR_RODADA = 3;

/** Queda que vira aviso mesmo sem meta: 5% ou mais desde a conferencia anterior. */
export const QUEDA_QUE_AVISA = 0.05;

export function precisaConferir(conferidoEm: string | null, agora: Date = new Date()): boolean {
  if (!conferidoEm) return true;
  const t = new Date(conferidoEm).getTime();
  if (Number.isNaN(t)) return true;
  return agora.getTime() - t >= HORAS_ENTRE_CONFERENCIAS * 3_600_000;
}

/**
 * A oferta que entra no historico.
 *
 * So anuncio de verdade (`linkKind` diferente de "busca": link de busca da
 * loja nao tem preco conferivel). Entre eles, preco visto na pagina vem antes
 * de preco so dito pela IA; e o menor ganha.
 */
export function melhorOferta(offers: readonly Offer[]): Offer | null {
  const anuncios = offers.filter((o) => o.linkKind !== "busca" && o.priceCents > 0);
  if (anuncios.length === 0) return null;
  const vistos = anuncios.filter((o) => o.priceSeen);
  const base = vistos.length > 0 ? vistos : anuncios;
  return base.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
}

function mediana(valores: readonly number[]): number {
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/**
 * Preco bom demais para ser o mesmo produto: menos da metade da mediana do
 * historico (com ao menos 3 conferencias). Costuma ser acessorio, refil ou
 * usado que a busca confundiu - aparece, mas nao vira aviso de "caiu!".
 */
export function suspeito(cents: Cents, anteriores: readonly Cents[]): boolean {
  if (anteriores.length < 3) return false;
  return cents < mediana(anteriores) * 0.5;
}

export interface Leitura {
  atualCents: Cents | null;
  anteriorCents: Cents | null;
  /** Positivo quando caiu. */
  quedaCents: Cents;
  quedaPct: number;
  menorCents: Cents | null;
  abaixoDaMeta: boolean;
  suspeito: boolean;
}

/** O que o historico diz agora. `historico` do mais novo para o mais antigo. */
export function ler(produto: Pick<RadarProduto, "metaCents">, historico: readonly RadarPreco[]): Leitura {
  const [atual, anterior] = historico;
  const atualCents = atual?.cents ?? null;
  const anteriorCents = anterior?.cents ?? null;
  const quedaCents = atualCents !== null && anteriorCents !== null ? anteriorCents - atualCents : 0;
  const ehSuspeito = atualCents !== null && suspeito(atualCents, historico.slice(1).map((p) => p.cents));
  return {
    atualCents,
    anteriorCents,
    quedaCents,
    quedaPct: anteriorCents ? quedaCents / anteriorCents : 0,
    menorCents: historico.length > 0 ? Math.min(...historico.map((p) => p.cents)) : null,
    abaixoDaMeta: atualCents !== null && produto.metaCents !== null && atualCents <= produto.metaCents,
    suspeito: ehSuspeito,
  };
}

export interface AvisoDoRadar {
  produtoId: string;
  nome: string;
  atualCents: Cents;
  loja: string;
  metaCents: Cents | null;
  quedaCents: Cents;
  motivo: "meta" | "queda";
}

/**
 * O que merece aviso no Inicio: chegou na meta, ou caiu 5% ou mais desde a
 * conferencia anterior. Preco suspeito nunca avisa. So vale a conferencia
 * recente (ate 36 h): aviso de semana passada ja nao e oportunidade.
 */
export function avisosDoRadar(
  itens: readonly { produto: RadarProduto; historico: readonly RadarPreco[] }[],
  agora: Date = new Date(),
): AvisoDoRadar[] {
  const out: AvisoDoRadar[] = [];
  for (const { produto, historico } of itens) {
    if (!produto.ativo) continue;
    const [atual] = historico;
    if (!atual) continue;
    if (agora.getTime() - new Date(atual.em).getTime() > 36 * 3_600_000) continue;
    const l = ler(produto, historico);
    if (l.suspeito || l.atualCents === null) continue;
    const motivo = l.abaixoDaMeta ? "meta" : l.quedaPct >= QUEDA_QUE_AVISA ? "queda" : null;
    if (!motivo) continue;
    out.push({
      produtoId: produto.id,
      nome: produto.nome,
      atualCents: l.atualCents,
      loja: atual.loja,
      metaCents: produto.metaCents,
      quedaCents: l.quedaCents,
      motivo,
    });
  }
  // Meta batida primeiro; depois a maior queda.
  return out.sort((a, b) => (a.motivo === b.motivo ? b.quedaCents - a.quedaCents : a.motivo === "meta" ? -1 : 1));
}

/** "Air fryer Mondial 4L": espacos colapsados, sem pontas. */
export function normalizarNome(nome: string): string {
  return nome.replace(/\s+/g, " ").trim();
}

/**
 * A imagem do produto, como a loja a publica para compartilhar o link (a
 * mesma que aparece no WhatsApp): `og:image`, `twitter:image` ou
 * `link rel=image_src`. Imagem de verdade, da pagina do anuncio - nunca um
 * endereco que a IA escreveu.
 *
 * So https, e relativa vira absoluta pela pagina. `null` quando nao ha.
 */
export function imagemDaPagina(html: string, paginaUrl: string): string | null {
  const metas = [
    /<meta[^>]+(?:property|name)=["'](?:og:image:secure_url|og:image|twitter:image(?::src)?)["'][^>]*>/gi,
    /<link[^>]+rel=["']image_src["'][^>]*>/gi,
  ];
  for (const re of metas) {
    for (const tag of html.match(re) ?? []) {
      const valor = /(?:content|href)=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!valor) continue;
      try {
        const u = new URL(valor.replace(/&amp;/g, "&").trim(), paginaUrl);
        if (u.protocol === "https:") return u.toString();
      } catch {
        // endereco quebrado: tenta a proxima
      }
    }
  }
  return null;
}
