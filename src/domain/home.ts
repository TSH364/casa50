import { formatCents, type Cents } from "@/lib/money";
import { currentMonth, daysInMonth, daysRemaining } from "./month";
import type { MonthKey } from "./types";

/**
 * O Inicio da nova interface: a barra da Dori, os avisos e os ramos.
 *
 * Tudo aqui e regra pura - a tela so desenha. As tres decisoes que mais
 * importam, e por isso tem teste:
 *
 *   * a Dori reage ao RITMO, e nao ao tamanho: crescer e o que uma barra faz
 *     quando o gasto sobe, entao o "vai bem / vai mal" sai da comparacao com
 *     o ritmo esperado para o dia, e o rabinho so abana num mes fechado
 *     abaixo do previsto;
 *   * no comeco do mes a barra nao infla (abaixo de 15%, so a cabeca), e
 *     acima de 100% ela para na ponta e o excesso vira texto;
 *   * os avisos sao no maximo dois, do mais grave ao menor.
 */

// ---------------------------------------------------------------------------
// A barra da Dori
// ---------------------------------------------------------------------------

export type DoriEstado =
  /** Casa sem lancamento nenhum. */
  | "vazio"
  /** Ha gasto, mas falta historico para prever o mes. */
  | "sem-previsao"
  /** Abaixo de 15% do previsto: so a cabeca, sem inflar a barra. */
  | "pequena"
  | "ritmo"
  | "acima"
  /** Passou do previsto: a cabeca para na ponta, o excesso vira texto. */
  | "passou"
  /** Mes encerrado abaixo do previsto: o rabinho abana. */
  | "fechou";

export interface DoriBarra {
  estado: DoriEstado;
  /** Gasto sobre o previsto, em %. Pode passar de 100. */
  pct: number;
  /** Onde a Dori deveria estar hoje, em %. `null` num mes encerrado. */
  ritmo: number | null;
  /** Acima do ritmo (ou do previsto): orelha em pe, numero em ambar. */
  alerta: boolean;
  excessoCents: Cents;
  /** O que o leitor de tela diz da barra. */
  rotulo: string;
}

/** Folga antes de chamar de "acima do ritmo": um dia de diferenca nao e alarme. */
const FOLGA_PP = 3;
const PEQUENA_PCT = 15;

export function doriBarra({
  spentCents,
  expectedCents,
  month,
  hasData,
  now = new Date(),
}: {
  spentCents: Cents;
  /** O previsto do mes; `null` quando falta historico. */
  expectedCents: Cents | null;
  month: MonthKey;
  /** A casa tem algum lancamento (em qualquer mes)? */
  hasData: boolean;
  now?: Date;
}): DoriBarra {
  if (!hasData) {
    return { estado: "vazio", pct: 0, ritmo: null, alerta: false, excessoCents: 0, rotulo: "Gasto do mês: ainda sem dados." };
  }
  if (expectedCents === null || expectedCents <= 0) {
    return {
      estado: "sem-previsao",
      pct: 0,
      ritmo: null,
      alerta: false,
      excessoCents: 0,
      rotulo: `Gasto do mês: ${formatCents(spentCents)}. Ainda sem previsão.`,
    };
  }

  const pct = Math.round((Math.max(0, spentCents) / expectedCents) * 100);
  const encerrado = month < currentMonth(now);
  const total = daysInMonth(month);
  const passados = total - daysRemaining(month, now) + 1;
  const ritmo = encerrado ? null : Math.max(0, Math.min(100, Math.round((Math.min(passados, total) / total) * 100)));
  const excessoCents = Math.max(0, spentCents - expectedCents);

  let estado: DoriEstado;
  if (pct > 100) estado = "passou";
  else if (encerrado) estado = "fechou";
  else if (pct > (ritmo ?? 100) + FOLGA_PP) estado = "acima";
  else if (pct < PEQUENA_PCT) estado = "pequena";
  else estado = "ritmo";
  const alerta = estado === "passou" || estado === "acima";

  const partes = [`Gasto do mês: ${pct}% do previsto`];
  if (ritmo !== null) partes.push(`ritmo esperado para hoje: ${ritmo}%`);
  if (estado === "acima") partes.push("acima do ritmo");
  if (estado === "passou") partes.push(`${formatCents(excessoCents)} acima do previsto`);
  if (estado === "fechou") partes.push("mês fechado abaixo do previsto");
  return { estado, pct, ritmo, alerta, excessoCents, rotulo: `${partes.join("; ")}.` };
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

export type AvisoTipo = "passou" | "orcamento" | "conta";

export interface Aviso {
  tipo: AvisoTipo;
  /** O nome da aba. */
  aba: string;
  texto: string;
  acao: string;
  href: string;
}

export function escolherAvisos(
  {
    orcamentos,
    contasFaltando,
  }: {
    orcamentos: { nome: string; categoryId: string; ratio: number; overCents: Cents }[];
    contasFaltando: { nome: string }[];
  },
  max = 2,
): Aviso[] {
  const passou = orcamentos
    .filter((o) => o.overCents > 0)
    .sort((a, b) => b.overCents - a.overCents)
    .map<Aviso>((o) => ({
      tipo: "passou",
      aba: "Orçamento",
      texto: `${o.nome} passou ${formatCents(o.overCents)} do limite.`,
      acao: "Ver os gastos",
      href: `/extratos?categoria=${o.categoryId}`,
    }));
  const contas = contasFaltando.map<Aviso>((c) => ({
    tipo: "conta",
    aba: "Conta fixa",
    texto: `${c.nome} não apareceu na fatura deste mês.`,
    acao: "Conferir",
    href: "/analise#proximos-meses",
  }));
  const perto = orcamentos
    .filter((o) => o.overCents === 0 && o.ratio >= 0.8)
    .sort((a, b) => b.ratio - a.ratio)
    .map<Aviso>((o) => ({
      tipo: "orcamento",
      aba: "Orçamento",
      texto: `${o.nome} já usou ${Math.floor(o.ratio * 100)}% do limite.`,
      acao: "Ver os gastos",
      href: `/extratos?categoria=${o.categoryId}`,
    }));
  return [...passou, ...contas, ...perto].slice(0, max);
}

// ---------------------------------------------------------------------------
// Para onde foi, em ramos
// ---------------------------------------------------------------------------

export interface Ramo {
  nome: string;
  cor: string;
  cents: Cents;
  /** Parte do total, 0 a 1. */
  parte: number;
  /** Comprimento da faixa, 0 a 1, relativo a maior; com um minimo para caber a %. */
  largura: number;
}

const LARGURA_MINIMA = 0.34;
const COR_OUTRAS = "#8B8B94";

/**
 * As categorias do mes como ramos: as maiores, e o resto junto em "Outras".
 * Categoria com total negativo (estorno maior que a despesa) fica de fora: um
 * ramo nao representa valor negativo.
 */
export function montarRamos(
  categorias: readonly { nome: string; cor: string; cents: Cents }[],
  max = 5,
): { ramos: Ramo[]; totalCents: Cents } {
  const positivas = categorias.filter((c) => c.cents > 0).sort((a, b) => b.cents - a.cents);
  const totalCents = positivas.reduce((s, c) => s + c.cents, 0);
  if (totalCents === 0) return { ramos: [], totalCents: 0 };

  const cabem = positivas.length > max ? positivas.slice(0, max - 1) : positivas;
  const resto = positivas.slice(cabem.length);
  const lista = resto.length
    ? [...cabem, { nome: "Outras", cor: COR_OUTRAS, cents: resto.reduce((s, c) => s + c.cents, 0) }]
    : cabem;
  const maior = Math.max(...lista.map((c) => c.cents));
  return {
    totalCents,
    ramos: lista.map((c) => ({
      nome: c.nome,
      cor: c.cor,
      cents: c.cents,
      parte: c.cents / totalCents,
      largura: Math.max(LARGURA_MINIMA, c.cents / maior),
    })),
  };
}

// ---------------------------------------------------------------------------
// Cor
// ---------------------------------------------------------------------------

function canais(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminancia([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** A cor um pouco mais escura, para o comeco do degrade da faixa. */
export function escurecer(hex: string, fator = 0.12): string {
  const c = canais(hex);
  if (!c) return hex;
  return `#${c.map((v) => Math.round(v * (1 - fator)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A tinta do texto SOBRE uma cor de categoria: escura ou branca, a que der
 * mais contraste. As cores sao escolhidas pela casa, entao nao da para fixar.
 */
export function tintaSobre(hex: string): "#08090c" | "#ffffff" {
  const c = canais(hex);
  if (!c) return "#08090c";
  const l = luminancia(c);
  const escura = (l + 0.05) / (luminancia([8, 9, 12]) + 0.05);
  const branca = 1.05 / (l + 0.05);
  return escura >= branca ? "#08090c" : "#ffffff";
}
