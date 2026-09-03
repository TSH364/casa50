import type { MonthKey, TransactionType } from "@/domain/types";
import type { Cents } from "@/lib/money";

/**
 * Tipos do fluxo de importação (secao 6).
 *
 * O princípio que organiza tudo aqui: o parser **nunca decide sozinho**. Ele
 * lê, classifica, marca o que não entendeu e devolve para revisão. Nenhuma
 * linha entra no banco sem passar pela tela de confirmação.
 */

/**
 * Como o arquivo representa uma despesa.
 *
 * O CSV real do Nubank traz despesa POSITIVA e pagamento negativo. O exemplo
 * da especificação (`PG *99 RIDE,"-32,90"`) usa a convenção oposta. As duas
 * existem no mundo, então detectamos por arquivo e pedimos confirmação em vez
 * de fixar uma no código - errar isso inverte a fatura inteira.
 */
export type SignConvention = "expense_positive" | "expense_negative";

export type ImportFormat = "csv" | "xlsx" | "pdf";

/** Papel de cada coluna do arquivo, detectado pelo cabeçalho. */
export interface ColumnMap {
  date: string | null;
  description: string | null;
  amount: string | null;
  /** Coluna de categoria do próprio banco, quando existe. É só uma dica. */
  category: string | null;
  /** Coluna de parcela, quando vem separada da descrição. */
  installment: string | null;
}

export type IssueLevel = "info" | "warning" | "error";

export interface ImportIssue {
  level: IssueLevel;
  message: string;
  /** Linha do arquivo (1-based, sem contar o cabeçalho). */
  row?: number;
}

/** Uma linha lida, ainda não gravada. */
export interface DraftTransaction {
  /** Índice da linha no arquivo, para referenciar na revisão. */
  row: number;
  date: string;
  invoiceMonth: MonthKey;
  description: string;
  merchantOriginal: string;
  merchantNormalized: string;
  amountCents: Cents;
  type: TransactionType;
  /** Nome da categoria sugerida pelo arquivo ou por regra aprendida. */
  categoryHint: string | null;
  categoryId: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  /** Chave usada para achar repetição, igual à do banco. */
  duplicateKey: string;
}

export type DraftDecision = "new" | "duplicate" | "ignored";

/** Linha já confrontada com o que existe no banco. */
export interface ReviewedDraft extends DraftTransaction {
  decision: DraftDecision;
  /** Preenchido quando `decision === "duplicate"`. */
  duplicateOfId?: string;
}

export interface ParseResult {
  format: ImportFormat;
  /** Sempre presente, mesmo quando há erros - o usuário precisa ver o que veio. */
  drafts: DraftTransaction[];
  columns: ColumnMap;
  /** Cabeçalhos originais, para o usuário remapear se a detecção errar. */
  headers: string[];
  signConvention: SignConvention;
  /** Mês inferido do nome do arquivo ou das datas. Sempre confirmável. */
  detectedMonth: MonthKey | null;
  /** Como o mês foi inferido, para explicar a sugestão ao usuário. */
  monthSource: "filename" | "dates" | null;
  institution: string | null;
  /** Total impresso pelo banco, quando o arquivo traz. */
  reportedTotalCents: Cents | null;
  issues: ImportIssue[];
}

export interface ImportSummary {
  total: number;
  new: number;
  duplicates: number;
  ignored: number;
  withoutCategory: number;
  /** Soma calculada das linhas que serão gravadas. */
  computedTotalCents: Cents;
  reportedTotalCents: Cents | null;
  /** Diferença entre o total do banco e o somado. `null` se não há total. */
  divergenceCents: Cents | null;
}
