import type { Cents } from "@/lib/money";
import type { IsoDate, Transaction } from "./types";

/**
 * Notas fiscais da planilha que o Gemini da casa preenche a partir do Gmail
 * ("Controle de Notas Fiscais e Compras"), ligadas as compras da fatura.
 *
 * A fatura diz "MERCADOLIVRE" ou "LEROY MERLIN"; a nota diz O QUE foi
 * comprado. Este arquivo e a parte pura: ler as linhas da planilha pelo nome
 * das colunas, dar a cada nota uma identidade estavel e casar nota com
 * compra.
 *
 * O QUE NAO SE GUARDA: a coluna de destinatario (nome, CPF, endereco). O app
 * nao precisa dela para ligar a nota a compra.
 */

export interface NotaDaPlanilha {
  /** Identidade estavel: a chave de acesso, ou CNPJ + numero, ou o conteudo. */
  chave: string;
  data: IsoDate;
  categoria: string | null;
  loja: string;
  cnpj: string | null;
  produto: string;
  /** `null` quando a planilha nao tem o valor ("Consultar Detalhe ML"). */
  valorCents: Cents | null;
  quem: string | null;
  pagamento: string | null;
  numero: string | null;
  pedido: string | null;
  chaveAcesso: string | null;
  linkEmail: string | null;
  /** Devolucao ou remessa sem pagamento: nao e compra, nao se casa. */
  semCompra: boolean;
}

/** O id da planilha a partir do link ("…/spreadsheets/d/<id>/edit…") ou do proprio id. */
export function idDaPlanilha(entrada: string): string | null {
  const t = entrada.trim();
  const m = t.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null;
}

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

type Campo =
  | "data"
  | "categoria"
  | "loja"
  | "cnpj"
  | "produto"
  | "valor"
  | "quem"
  | "pagamento"
  | "numero"
  | "pedido"
  | "chave"
  | "link";

/** Qual coluna e qual, pelo nome - a ordem das colunas pode mudar. */
const COLUNAS: [Campo, RegExp][] = [
  ["data", /^data/],
  ["categoria", /categoria/],
  ["loja", /loja|emitente/],
  ["cnpj", /cnpj|ccm/],
  ["produto", /produto|servico/],
  ["valor", /valor/],
  ["quem", /quem/],
  ["pagamento", /pagamento/],
  ["numero", /nota fiscal|n.? da nota/],
  ["pedido", /pedido/],
  ["chave", /chave|verificacao/],
  ["link", /link/],
];

function mapaDeColunas(cabecalho: readonly unknown[]): Partial<Record<Campo, number>> {
  const mapa: Partial<Record<Campo, number>> = {};
  cabecalho.forEach((c, i) => {
    const nome = semAcento(String(c ?? "")).trim();
    if (!nome || /destinat|endereco/.test(nome)) return;
    const campo = COLUNAS.find(([campo, re]) => mapa[campo] === undefined && re.test(nome))?.[0];
    if (campo) mapa[campo] = i;
  });
  return mapa;
}

/** "18/10/2026", "2026-10-18" ou o numero de serie do Sheets. */
function lerData(v: unknown): IsoDate | null {
  if (typeof v === "number" && v > 30000 && v < 80000) {
    // Serie do Sheets: dias desde 30/12/1899.
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "R$ 1.234,56" ou 1234.56. Texto ("Consultar Detalhe ML") e `null`. */
function lerValor(v: unknown): Cents | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  const m = String(v ?? "").match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/);
  if (!m) return null;
  const n = Number(`${m[1]!.replace(/\./g, "")}.${m[2]}`);
  return n > 0 ? Math.round(n * 100) : null;
}

const texto = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** As notas das linhas da planilha. A primeira linha com "Data" e "Loja" e o cabecalho. */
export function lerNotas(linhas: readonly (readonly unknown[])[]): NotaDaPlanilha[] {
  const ini = linhas.findIndex((l) => {
    const m = mapaDeColunas(l);
    return m.data !== undefined && m.loja !== undefined;
  });
  if (ini < 0) return [];
  const col = mapaDeColunas(linhas[ini]!);
  const pega = (l: readonly unknown[], c: Campo) => (col[c] === undefined ? undefined : l[col[c]!]);

  const vistas = new Set<string>();
  const notas: NotaDaPlanilha[] = [];
  for (const l of linhas.slice(ini + 1)) {
    const data = lerData(pega(l, "data"));
    const loja = texto(pega(l, "loja"), 200);
    if (!data || !loja) continue;
    const cnpj = texto(pega(l, "cnpj"), 40);
    const numero = texto(pega(l, "numero"), 80);
    const chaveBruta = texto(pega(l, "chave"), 80);
    const chaveAcesso = chaveBruta && /^\d{44}$/.test(chaveBruta.replace(/\s/g, "")) ? chaveBruta.replace(/\s/g, "") : null;
    const produto = texto(pega(l, "produto"), 300) ?? "(sem descrição)";
    const pagamento = texto(pega(l, "pagamento"), 80);
    const linkBruto = texto(pega(l, "link"), 500);

    const base = chaveAcesso
      ? `nfe:${chaveAcesso}`
      : cnpj && numero
        ? `num:${cnpj.replace(/\D/g, "") || semAcento(cnpj)}:${semAcento(numero).replace(/[^a-z0-9]/g, "")}`
        : `txt:${data}:${semAcento(loja).replace(/[^a-z0-9]/g, "").slice(0, 40)}:${semAcento(produto).replace(/[^a-z0-9]/g, "").slice(0, 40)}`;
    // A mesma nota em duas linhas (o Gemini as vezes repete): fica uma.
    if (vistas.has(base)) continue;
    vistas.add(base);

    const devolucao = /devolu|remessa|sem pagamento/i.test(`${pagamento ?? ""} ${produto}`);
    notas.push({
      chave: base.slice(0, 200),
      data,
      categoria: texto(pega(l, "categoria"), 120),
      loja,
      cnpj,
      produto,
      valorCents: lerValor(pega(l, "valor")),
      quem: texto(pega(l, "quem"), 60),
      pagamento,
      numero,
      pedido: texto(pega(l, "pedido"), 80),
      chaveAcesso,
      // So link do Gmail: a coluna e preenchida por IA, e o app nao abre outro endereco.
      linkEmail: linkBruto && linkBruto.startsWith("https://mail.google.com/") ? linkBruto : null,
      semCompra: devolucao,
    });
  }
  return notas;
}

// ---------------------------------------------------------------------------
// Casar nota com compra
// ---------------------------------------------------------------------------

const PALAVRAS_VAZIAS = new Set([
  "ltda", "ltd", "eireli", "me", "sa", "s/a", "cia", "companhia", "comercio", "comercial", "brasil", "brasileira",
  "loja", "lojas", "servicos", "industria", "via", "de", "da", "do", "e", "the", "store", "shop", "virtual",
  "distribuicao", "artigos", "produtos", "equipamentos", "materiais",
]);

/** Como a loja da nota aparece na fatura. */
export function sinaisDaLoja(loja: string): string[] {
  const s = semAcento(loja);
  if (/mercado ?livre|mercado ?pago/.test(s)) return ["MERCADOLIVRE", "MERCADOPAGO", "MERCADO LIVRE", "MERCADO PAGO", "MELI", "MP *", "MP*"];
  const palavras = s
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p) && !/^\d+$/.test(p));
  return palavras.slice(0, 2).map((p) => p.toUpperCase());
}

function textoDaCompra(t: Transaction): string {
  return semAcento([t.merchantAlias, t.merchantNormalized, t.merchantOriginal, t.description].filter(Boolean).join(" ")).toUpperCase();
}

const DIA = 86_400_000;
const dias = (a: IsoDate, b: IsoDate) =>
  Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / DIA);

/** O valor bate: a compra inteira, ou a parcela vezes o numero de parcelas. */
function valorBate(nota: Cents, t: Transaction): boolean {
  const c = Math.round(t.amount * 100);
  const folga = (v: number) => Math.max(1, Math.round(v * 0.01));
  if (Math.abs(c - nota) <= folga(nota)) return true;
  const total = t.installment?.total ?? 0;
  return total > 1 && Math.abs(c * total - nota) <= folga(nota) + total;
}

/**
 * Para cada nota ainda sem compra, a compra dela - ou nenhuma, na duvida.
 *
 * A compra vem da mesma loja, de 7 dias antes a 3 dias depois da nota (a nota
 * sai quando o pedido e despachado, dias depois da compra). Com valor na
 * nota, o valor tem de bater; sem valor (o Mercado Livre muitas vezes), so
 * quando ha UMA compra possivel. Duas candidatas igualmente boas: nada - um
 * par errado e pior que nenhum. Cada compra recebe uma nota so.
 */
export function casarNotas(
  notas: readonly { chave: string; data: IsoDate; loja: string; valorCents: Cents | null; semCompra: boolean }[],
  compras: readonly Transaction[],
  jaLigadas: ReadonlySet<string>,
): Map<string, string> {
  const usadas = new Set(jaLigadas);
  const pares = new Map<string, string>();
  const candidatasDe = (n: (typeof notas)[number], janela: [number, number]) => {
    const sinais = sinaisDaLoja(n.loja);
    if (sinais.length === 0) return [];
    return compras.filter((t) => {
      if (usadas.has(t.id) || t.type !== "expense" || t.isHidden) return false;
      const d = dias(t.date, n.data);
      if (d < janela[0] || d > janela[1]) return false;
      const txt = textoDaCompra(t);
      return sinais.some((s) => txt.includes(s));
    });
  };

  // Com valor primeiro: sao os pares mais certos, e tiram compras da disputa.
  const ordem = [...notas].filter((n) => !n.semCompra).sort((a, b) => Number(b.valorCents !== null) - Number(a.valorCents !== null));
  for (const n of ordem) {
    let escolhida: Transaction | null = null;
    if (n.valorCents !== null) {
      const c = candidatasDe(n, [-7, 3]).filter((t) => valorBate(n.valorCents!, t));
      const melhor = Math.min(...c.map((t) => Math.abs(dias(t.date, n.data))));
      const empatadas = c.filter((t) => Math.abs(dias(t.date, n.data)) === melhor);
      if (empatadas.length === 1) escolhida = empatadas[0]!;
    } else {
      const c = candidatasDe(n, [-5, 2]);
      if (c.length === 1) escolhida = c[0]!;
    }
    if (escolhida) {
      pares.set(n.chave, escolhida.id);
      usadas.add(escolhida.id);
    }
  }
  return pares;
}

/** O que a lista de lancamentos mostra de uma nota ligada a compra. */
export interface NotaResumo {
  produto: string;
  numero: string | null;
  loja: string;
  linkEmail: string | null;
}
