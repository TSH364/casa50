import type { MonthKey, TransactionType } from "@/domain/types";
import type { Cents } from "@/lib/money";
import { isMonthKey } from "@/domain/month";
import type { ColumnMap, SignConvention } from "./types";

/**
 * Heurísticas de leitura de fatura.
 *
 * Tudo aqui é sugestão, nunca decisão final: a tela de revisão mostra o que
 * foi inferido e deixa o usuário corrigir antes de gravar (secao 6).
 */

// --------------------------------------------------------------------------
// Normalização de estabelecimento
// --------------------------------------------------------------------------

/**
 * Prefixos de adquirente que aparecem colados no nome da loja.
 *
 * O separador é obrigatório - `*` ou espaço. Sem essa exigência, "PAG"
 * casaria com o começo de "PAGUE MENOS" e a loja viraria "UE MENOS".
 */
const ACQUIRER_PREFIX =
  /^\s*(PG|DL|PAG|PGTO|COMPRA|CB|EC|MP|PP|IFD|APL)(?:\s*\*\s*|\s+)/;
/** Sufixo de parcela: "3/12", "- Parcela 3/12". */
const INSTALLMENT_SUFFIX = /\s*-?\s*(PARCELA\s*)?\d{1,2}\s*\/\s*\d{1,2}\s*$/;
/** Faixa de acentos combinantes, removida após a decomposição NFD. */
const COMBINING_MARKS = /[̀-ͯ]/g;

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "");
}

/**
 * Mesma normalização de `app.normalize_merchant` no banco.
 *
 * Existe em duas linguagens de propósito: o banco precisa dela para preencher
 * `merchant_normalized` em qualquer gravação (inclusive por script), e o
 * importador precisa dela antes de gravar, para agrupar e comparar. As duas
 * implementações são cobertas pelos mesmos exemplos nos testes.
 */
export function normalizeMerchant(raw: string): string {
  return stripAccents(raw)
    .toUpperCase()
    .replace(ACQUIRER_PREFIX, "")
    .replace(INSTALLMENT_SUFFIX, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Identidade de um lançamento para efeito de duplicidade (secao 6).
 *
 * Inclui mês da fatura, data, cartão e parcela justamente para NÃO colapsar
 * compras legítimas repetidas: a mesma assinatura em meses diferentes, ou a
 * parcela 3/10 e a 4/10, têm chaves distintas.
 */
export function duplicateKey(input: {
  invoiceMonth: MonthKey;
  date: string;
  merchantNormalized: string;
  amountCents: Cents;
  cardId?: string | null;
  installmentCurrent?: number | null;
  installmentTotal?: number | null;
}): string {
  return [
    input.invoiceMonth,
    input.date,
    input.merchantNormalized,
    String(input.amountCents),
    input.cardId ?? "",
    input.installmentCurrent ?? "",
    input.installmentTotal ?? "",
  ].join("|");
}

// --------------------------------------------------------------------------
// Parcela dentro da descrição
// --------------------------------------------------------------------------

const INSTALLMENT_IN_TEXT = /(?:parcela\s*)?\b(\d{1,2})\s*\/\s*(\d{1,2})\b/i;

/** Extrai "3/12" de "NETFLIX 3/12". Devolve `null` quando não há parcela. */
export function extractInstallment(
  description: string,
): { current: number; total: number } | null {
  const match = description.match(INSTALLMENT_IN_TEXT);
  if (!match) return null;

  const current = Number(match[1]);
  const total = Number(match[2]);
  // "12/2026" numa descrição é data, não parcela: a parcela atual nunca passa
  // do total, e nenhuma compra é dividida em mais de 99 vezes.
  if (current < 1 || total < 1 || current > total) return null;
  return { current, total };
}

// --------------------------------------------------------------------------
// Mês pelo nome do arquivo
// --------------------------------------------------------------------------

const MONTH_NAMES: Record<string, string> = {
  jan: "01", janeiro: "01",
  fev: "02", fevereiro: "02",
  mar: "03", marco: "03",
  abr: "04", abril: "04",
  mai: "05", maio: "05",
  jun: "06", junho: "06",
  jul: "07", julho: "07",
  ago: "08", agosto: "08",
  set: "09", setembro: "09",
  out: "10", outubro: "10",
  nov: "11", novembro: "11",
  dez: "12", dezembro: "12",
};

/**
 * Descobre o mês pelo nome do arquivo.
 *
 * Reconhece `2026-08`, `08-2026`, `202608` e nomes de mês em português
 * ("agosto-2026", "ago_2026"). Devolve `null` quando não há certeza - e aí a
 * tela pede o mês, em vez de chutar.
 */
export function monthFromFilename(fileName: string): MonthKey | null {
  const name = stripAccents(fileName.replace(/\.[a-z0-9]+$/i, "")).toLowerCase();

  // 2026-08 / 2026_08 / 2026.08, com um dia opcional que é ignorado.
  const iso = name.match(/(20\d{2})[-_.](0[1-9]|1[0-2])(?:[-_.]\d{1,2})?/);
  if (iso) return `${iso[1]}-${iso[2]}`;

  // 08-2026 / 08_2026. Sem `\b`: "_" conta como caractere de palavra, então
  // não existe fronteira entre "fatura_" e "08" e a busca falhava nesse nome.
  const br = name.match(/(?<!\d)(0[1-9]|1[0-2])[-_.](20\d{2})(?!\d)/);
  if (br) return `${br[2]}-${br[1]}`;

  // agosto2026 / ago-2026 / 2026 agosto
  const named = name.match(
    /\b([a-z]{3,9})[-_. ]*(20\d{2})\b|\b(20\d{2})[-_. ]*([a-z]{3,9})\b/,
  );
  if (named) {
    const word = named[1] ?? named[4] ?? "";
    const year = named[2] ?? named[3];
    const month = MONTH_NAMES[word];
    if (month && year) return `${year}-${month}`;
  }

  // 202608 colado - exige que não seja pedaço de um número maior.
  const compact = name.match(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
  if (compact) return `${compact[1]}-${compact[2]}`;

  return null;
}

/** Mês mais frequente entre as datas lidas - usado quando o nome não diz. */
export function monthFromDates(dates: readonly string[]): MonthKey | null {
  const counts = new Map<MonthKey, number>();
  for (const date of dates) {
    const month = date.slice(0, 7);
    if (!isMonthKey(month)) continue;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }

  let best: MonthKey | null = null;
  let bestCount = 0;
  for (const [month, count] of counts) {
    if (count > bestCount) {
      best = month;
      bestCount = count;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// Colunas
// --------------------------------------------------------------------------

const HEADER_HINTS: Record<keyof ColumnMap, readonly string[]> = {
  date: ["date", "data", "data da compra", "datacompra", "data transacao"],
  description: [
    "title", "descricao", "description", "estabelecimento",
    "historico", "lancamento", "detalhe",
  ],
  amount: ["amount", "valor", "value", "valor (r$)", "montante"],
  category: ["category", "categoria"],
  installment: ["installment", "parcela", "parcelas"],
};

function normalizeHeader(header: string): string {
  return stripAccents(header)
    .toLowerCase()
    .replace(/[^a-z0-9 ()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Casa os cabeçalhos do arquivo com os papéis que o importador entende. */
export function detectColumns(headers: readonly string[]): ColumnMap {
  const map: ColumnMap = {
    date: null,
    description: null,
    amount: null,
    category: null,
    installment: null,
  };
  const normalized = headers.map((h) => ({ raw: h, key: normalizeHeader(h) }));

  for (const role of Object.keys(HEADER_HINTS) as (keyof ColumnMap)[]) {
    const hints = HEADER_HINTS[role];
    const hit =
      normalized.find((h) => hints.includes(h.key)) ??
      normalized.find((h) => hints.some((hint) => h.key.startsWith(hint)));
    if (hit) map[role] = hit.raw;
  }
  return map;
}

// --------------------------------------------------------------------------
// Convenção de sinal
// --------------------------------------------------------------------------

/**
 * Descobre se despesa vem positiva ou negativa no arquivo.
 *
 * Uma fatura de cartão é quase toda despesa; pagamento e estorno são poucos.
 * Então o sinal da maioria é o sinal da despesa. Empate ou arquivo vazio caem
 * em `expense_positive`, que é o formato real do Nubank.
 *
 * A tela mostra a conclusão e permite inverter - errar aqui inverteria a
 * fatura inteira, e nenhum palpite deve valer sem confirmação.
 */
export function detectSignConvention(
  amounts: readonly number[],
): SignConvention {
  let positives = 0;
  let negatives = 0;
  for (const amount of amounts) {
    if (amount > 0) positives += 1;
    else if (amount < 0) negatives += 1;
  }
  return negatives > positives ? "expense_negative" : "expense_positive";
}

// --------------------------------------------------------------------------
// Classificação do tipo
// --------------------------------------------------------------------------

/** Cobranças do próprio cartão, que a secao 12 separa do gasto do casal. */
const FEE_PATTERNS = [
  /\banuidade\b/i,
  /\biof\b/i,
  /\bjuros\b/i,
  /\bmulta\b/i,
  /\btarifa\b/i,
  /\bencargos?\b/i,
  /\bseguro\b/i,
];

/** Quitação da fatura. Padrões específicos, nunca a palavra solta. */
const PAYMENT_PATTERNS = [
  /pagamento\s+recebido/i,
  /pagamento\s+em\s+/i,
  /\bpgto\s+recebido/i,
  /pagamento\s+de\s+fatura/i,
  /saldo\s+em\s+aberto\s+anterior/i,
];

const REFUND_PATTERNS = [
  /\bestorno\b/i,
  /\bdevolu[cç][aã]o\b/i,
  /\breembolso\b/i,
  /\bcancelamento\b/i,
];

/**
 * Decide o tipo do lançamento.
 *
 * `signed` é o valor como veio no arquivo; `convention` diz qual sinal
 * significa despesa.
 *
 * Cuidado deliberado com "Desconto" (secao 6): a palavra aparece como
 * *categoria* em alguns exports do Nubank e não pode virar pagamento. Só a
 * descrição é consultada aqui, e "desconto" não está em nenhuma lista - um
 * desconto de sinal invertido cai em `refund`, que é o que ele é.
 */
export function classifyType(
  description: string,
  signed: number,
  convention: SignConvention,
): TransactionType {
  const isExpenseSide =
    convention === "expense_positive" ? signed > 0 : signed < 0;

  if (isExpenseSide) {
    return FEE_PATTERNS.some((p) => p.test(description)) ? "fee" : "expense";
  }

  if (PAYMENT_PATTERNS.some((p) => p.test(description))) return "payment";
  if (REFUND_PATTERNS.some((p) => p.test(description))) return "refund";

  // Valor do lado contrário sem padrão reconhecido: é dinheiro que voltou.
  // Marcar como `refund` (e não `payment`) mantém o total do mês correto,
  // porque estorno abate a despesa em vez de sair da conta.
  return "refund";
}
