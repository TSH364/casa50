import { normalizeMerchant } from "@/importers/detect";
import type { Cents } from "@/lib/money";
import type { MonthKey, TransactionType } from "./types";

/**
 * O que vem do Meu Pluggy, e como vira lancamento do app.
 *
 * So o formato que o app usa da API da Pluggy (contas e transacoes). Tudo
 * aqui e puro e testado; a conversa com a API mora em `lib/pluggy.ts`.
 *
 * Nesta primeira versao, so CARTAO DE CREDITO: e onde mora o gasto do mes, e
 * a conciliacao com a fatura ja existe. Conta corrente traz Pix, mas tambem o
 * pagamento da fatura e transferencias entre contas do casal - lancar isso
 * sem filtro contaria o mesmo dinheiro duas vezes.
 */

export interface PluggyAccount {
  id: string;
  itemId?: string;
  type: string; // "BANK" | "CREDIT"
  subtype?: string | null; // "CREDIT_CARD", "CHECKING_ACCOUNT"...
  name: string;
  marketingName?: string | null;
  number?: string | null;
  creditData?: {
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
  } | null;
}

export interface PluggyTransaction {
  id: string;
  accountId?: string;
  description: string;
  descriptionRaw?: string | null;
  amount: number;
  date: string;
  type?: "DEBIT" | "CREDIT" | string | null;
  status?: "POSTED" | "PENDING" | string | null;
  category?: string | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    cardNumber?: string | null;
  } | null;
  merchant?: { name?: string | null; businessName?: string | null } | null;
}

/** O lancamento que a sincronizacao grava, antes da categoria. */
export interface LancamentoDoBanco {
  externalId: string;
  date: string;
  invoiceMonth: MonthKey;
  description: string;
  merchantOriginal: string;
  merchantNormalized: string;
  amountCents: Cents;
  type: TransactionType;
  cardLastFour: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
}

export const ehCartaoDeCredito = (a: PluggyAccount): boolean =>
  a.type === "CREDIT" || a.subtype === "CREDIT_CARD";

/** Os 4 ultimos digitos de "•••• 2150", "5162********2150" ou "2150". */
export function ultimosQuatro(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = /(\d{4})\D*$/.exec(texto);
  return m ? m[1]! : null;
}

/** O nome que a casa ve no cartao criado pela sincronizacao: "Nubank Ultravioleta". */
export function nomeDaConta(a: PluggyAccount): string {
  const nome = (a.marketingName || a.name || "").trim();
  return nome.length >= 2 ? nome.slice(0, 60) : "Cartão";
}

function addMes(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` as MonthKey;
}

/**
 * Em que fatura a compra cai - o mes em que a fatura VENCE, que e como a casa
 * chama a fatura ("a de outubro").
 *
 * Com o fechamento conhecido: compra no dia do fechamento ou depois ja vai
 * para a fatura seguinte; e se o vencimento e num dia antes do fechamento
 * (fecha 28, vence 5), a fatura vence no mes seguinte ao do fechamento. Sem
 * o fechamento, o mes da compra - o mesmo que o lancamento a mao usa.
 */
export function mesDaFatura(
  data: string,
  cartao: { closingDay: number | null; dueDay: number | null },
): MonthKey {
  const mes = data.slice(0, 7) as MonthKey;
  const dia = Number(data.slice(8, 10));
  if (!cartao.closingDay) return mes;
  const fecha = dia >= cartao.closingDay ? addMes(mes, 1) : mes;
  return cartao.dueDay !== null && cartao.dueDay < cartao.closingDay ? addMes(fecha, 1) : fecha;
}

/** Fechamento e vencimento lidos da conta, quando o cartao da casa nao tem. */
export function diasDoCartao(a: PluggyAccount): { closingDay: number | null; dueDay: number | null } {
  const dia = (iso: string | null | undefined) => {
    const n = iso ? Number(iso.slice(8, 10)) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
  };
  return { closingDay: dia(a.creditData?.balanceCloseDate), dueDay: dia(a.creditData?.balanceDueDate) };
}

/** Pagamento da fatura: entra no cartao como credito, mas nao e gasto nem estorno. */
const PAGAMENTO = /pagamento|pgto|payment/i;

/**
 * Uma transacao do cartao como lancamento, ou `null` quando nao entra:
 * pendente (o banco ainda pode mudar ou cancelar), valor zero, ou pagamento
 * da fatura.
 */
export function paraLancamento(
  tx: PluggyTransaction,
  conta: PluggyAccount,
  cartao: { closingDay: number | null; dueDay: number | null },
): LancamentoDoBanco | null {
  if (!ehCartaoDeCredito(conta)) return null;
  if (tx.status && tx.status !== "POSTED") return null;
  const amountCents = Math.round(Math.abs(tx.amount) * 100);
  if (amountCents === 0) return null;

  // O tipo da Pluggy diz o sentido; o sinal do valor fica de reserva.
  const saida = tx.type ? tx.type === "DEBIT" : tx.amount > 0;
  if (!saida && (PAGAMENTO.test(tx.description) || PAGAMENTO.test(tx.category ?? ""))) return null;

  const date = tx.date.slice(0, 10);
  const loja = (tx.merchant?.businessName || tx.merchant?.name || tx.description).trim();
  const parcelaTotal = tx.creditCardMetadata?.totalInstallments ?? null;
  const parcela = tx.creditCardMetadata?.installmentNumber ?? null;
  const temParcela = parcelaTotal !== null && parcelaTotal > 1 && parcela !== null && parcela >= 1 && parcela <= parcelaTotal;

  return {
    externalId: `pluggy:${tx.id}`,
    date,
    invoiceMonth: mesDaFatura(date, cartao),
    description: tx.description.trim().slice(0, 300),
    merchantOriginal: loja.slice(0, 300),
    merchantNormalized: normalizeMerchant(loja),
    amountCents,
    type: saida ? "expense" : "refund",
    cardLastFour: ultimosQuatro(tx.creditCardMetadata?.cardNumber) ?? ultimosQuatro(conta.number),
    installmentCurrent: temParcela ? parcela : null,
    installmentTotal: temParcela ? parcelaTotal : null,
  };
}

/** De onde a sincronizacao recomeca: alguns dias antes da ultima, para pegar o que o banco lancou atrasado. */
export const DIAS_DE_RECUO = 10;
/** Na primeira vez: a fatura aberta e a anterior. */
export const DIAS_NA_PRIMEIRA = 45;
/** Abrir o app sincroniza de novo depois deste tempo. */
export const HORAS_ENTRE_SINCRONIAS = 6;

export function inicioDaJanela(ultima: string | null, hoje: Date): string {
  const base = ultima ? new Date(ultima) : hoje;
  const dias = ultima ? DIAS_DE_RECUO : DIAS_NA_PRIMEIRA;
  const d = new Date(base.getTime() - dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function precisaSincronizar(ultima: string | null, agora: Date): boolean {
  if (!ultima) return true;
  return agora.getTime() - new Date(ultima).getTime() >= HORAS_ENTRE_SINCRONIAS * 3_600_000;
}
