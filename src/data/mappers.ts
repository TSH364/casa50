import type {
  Budget,
  Card,
  Category,
  ForecastStatus,
  Goal,
  Recurrence,
  MonthKey,
  Transaction,
  TransactionOrigin,
  TransactionType,
  Visibility,
  SplitType,
} from "@/domain/types";

/**
 * Conversao entre linha do Postgres e tipo de dominio.
 *
 * Duas traducoes acontecem aqui e em nenhum outro lugar:
 *
 * 1. `snake_case` do banco vira `camelCase` do TypeScript.
 * 2. `invoice_month`, que no banco e um `date` no dia 1, vira a chave
 *    `YYYY-MM` que `src/domain` usa. A conversao e por fatiamento de string,
 *    nunca por `new Date(...)`: a data vem em UTC e, no fuso de Brasilia,
 *    `getMonth()` devolveria o mes anterior.
 */

/** `"2026-08-01"` (ou ISO completo) -> `"2026-08"`. */
export function toMonthKey(value: string): MonthKey {
  return value.slice(0, 7);
}

/** `"2026-08"` -> `"2026-08-01"`, formato que o Postgres aceita como `date`. */
export function fromMonthKey(month: MonthKey): string {
  return `${month}-01`;
}

/** Numeric do Postgres chega como string via PostgREST. */
function num(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const CARD_COLUMNS =
  "id, house_id, name, institution, last_four, brand, owner_id, closing_day, due_day, credit_limit, is_active";

export function mapCard(row: Record<string, unknown>): Card {
  return {
    id: row.id as string,
    houseId: row.house_id as string,
    name: row.name as string,
    institution: (row.institution as string | null) ?? null,
    lastFour: (row.last_four as string | null) ?? null,
    brand: (row.brand as string | null) ?? null,
    ownerId: (row.owner_id as string | null) ?? null,
    closingDay: (row.closing_day as number | null) ?? null,
    dueDay: (row.due_day as number | null) ?? null,
    creditLimit: numOrNull(row.credit_limit),
    isActive: row.is_active as boolean,
  };
}

export const CATEGORY_COLUMNS =
  "id, house_id, name, color, icon, parent_id, is_active";

export function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: row.id as string,
    houseId: row.house_id as string,
    name: row.name as string,
    color: row.color as string,
    icon: (row.icon as string | null) ?? null,
    parentId: (row.parent_id as string | null) ?? null,
    isActive: row.is_active as boolean,
  };
}

export const TRANSACTION_COLUMNS = `
  id, house_id, invoice_id, card_id, member_id, date, invoice_month,
  description, merchant_original, merchant_normalized, merchant_alias,
  amount, currency, original_amount, original_currency,
  type, origin, status, category_id, subcategory_id, note, receipt_url,
  visibility, split_type, split_percentage,
  installment_current, installment_total, installment_value,
  recurring_id, reconciled_with_id, is_hidden, is_reconciled,
  created_by, created_at, updated_at
`;

export function mapTransaction(row: Record<string, unknown>): Transaction {
  const current = row.installment_current as number | null;
  const total = row.installment_total as number | null;

  return {
    id: row.id as string,
    houseId: row.house_id as string,
    invoiceId: (row.invoice_id as string | null) ?? null,
    cardId: (row.card_id as string | null) ?? null,
    memberId: (row.member_id as string | null) ?? null,

    date: (row.date as string).slice(0, 10),
    invoiceMonth: toMonthKey(row.invoice_month as string),

    description: row.description as string,
    merchantOriginal: (row.merchant_original as string | null) ?? null,
    merchantNormalized: (row.merchant_normalized as string | null) ?? null,
    merchantAlias: (row.merchant_alias as string | null) ?? null,

    amount: num(row.amount),
    currency: (row.currency as string) ?? "BRL",
    originalAmount: numOrNull(row.original_amount),
    originalCurrency: (row.original_currency as string | null) ?? null,

    type: row.type as TransactionType,
    origin: row.origin as TransactionOrigin,
    status: row.status as ForecastStatus,

    categoryId: (row.category_id as string | null) ?? null,
    subcategoryId: (row.subcategory_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    receiptUrl: (row.receipt_url as string | null) ?? null,

    visibility: row.visibility as Visibility,
    splitType: row.split_type as SplitType,
    splitPercentage:
      (row.split_percentage as Record<string, number> | null) ?? null,

    // Par sempre completo ou sempre ausente - garantido por constraint no banco.
    installment:
      current !== null && total !== null
        ? { current, total, value: numOrNull(row.installment_value) }
        : null,

    recurringId: (row.recurring_id as string | null) ?? null,
    reconciledWithId: (row.reconciled_with_id as string | null) ?? null,

    isHidden: row.is_hidden as boolean,
    isReconciled: row.is_reconciled as boolean,

    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const RECURRENCE_COLUMNS =
  "id, house_id, description, merchant, amount, category_id, card_id, owner_id, interval, next_date, expected_day, is_active, source";

export function mapRecurrence(row: Record<string, unknown>): Recurrence {
  return {
    id: row.id as string,
    houseId: row.house_id as string,
    description: row.description as string,
    merchant: (row.merchant as string | null) ?? null,
    amount: Number(row.amount),
    categoryId: (row.category_id as string | null) ?? null,
    cardId: (row.card_id as string | null) ?? null,
    ownerId: (row.owner_id as string | null) ?? null,
    interval: row.interval as Recurrence["interval"],
    nextDate: String(row.next_date).slice(0, 10),
    expectedDay: (row.expected_day as number | null) ?? null,
    isActive: Boolean(row.is_active),
    source: row.source as "manual" | "detected",
  };
}

export const BUDGET_COLUMNS = "id, house_id, category_id, month, limit_amount";

export function mapBudget(row: Record<string, unknown>): Budget {
  return {
    id: row.id as string,
    houseId: row.house_id as string,
    categoryId: row.category_id as string,
    month: toMonthKey(row.month as string),
    limitAmount: Number(row.limit_amount),
  };
}

export const GOAL_COLUMNS =
  "id, house_id, name, target_amount, target_date, monthly_contribution, owner_id, note, status";

/**
 * `currentAmount` nao existe como coluna: e a soma dos depositos da meta.
 * Quem consulta passa o total ja somado, para a meta nunca exibir um
 * acumulado que nao corresponde aos depositos gravados.
 */
export function mapGoal(
  row: Record<string, unknown>,
  currentAmount = 0,
): Goal {
  return {
    id: row.id as string,
    houseId: row.house_id as string,
    name: row.name as string,
    targetAmount: Number(row.target_amount),
    currentAmount,
    targetDate: row.target_date ? String(row.target_date).slice(0, 10) : null,
    monthlyContribution:
      row.monthly_contribution === null ? null : Number(row.monthly_contribution),
    ownerId: (row.owner_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    status: row.status as Goal["status"],
  };
}
