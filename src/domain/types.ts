/**
 * Tipos de dominio, espelhando o schema em supabase/migrations.
 *
 * Escritos a mao (e nao gerados) porque a Etapa 1 precisa compilar antes de
 * existir um projeto Supabase para apontar o `supabase gen types`. Quando o
 * banco estiver de pe, `npm run db:types` regenera `src/lib/database.types.ts`
 * e estes tipos passam a ser a camada de dominio sobre aqueles.
 */

export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type MemberStatus = "invited" | "active" | "left";

export type TransactionType =
  | "expense"
  | "income"
  | "payment"
  | "refund"
  | "fee"
  | "adjustment";

export type TransactionOrigin =
  | "invoice"
  | "manual"
  | "recurrence"
  | "imported_statement";

export type Visibility = "individual" | "shared";
export type SplitType = "none" | "equal" | "income_proportional" | "custom";

/** Ciclo previsto -> realizado da secao 18. */
export type ForecastStatus =
  | "forecast"
  | "confirmed"
  | "cancelled"
  | "missing"
  | "divergent";

export type RecurrenceInterval = "weekly" | "monthly" | "yearly";
export type InvoiceStatus = "pending" | "imported" | "failed" | "reverted";
export type InvoiceFormat = "csv" | "xlsx" | "pdf" | "manual";
export type GoalStatus = "active" | "completed" | "paused" | "cancelled";

/** Chave de mes no formato `YYYY-MM`. */
export type MonthKey = string;
/** Data no formato `YYYY-MM-DD`. */
export type IsoDate = string;

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
}

export interface House {
  id: string;
  name: string;
  ownerId: string;
}

export interface HouseMember {
  id: string;
  houseId: string;
  userId: string | null;
  inviteEmail: string | null;
  role: MemberRole;
  status: MemberStatus;
  profile?: Profile;
}

export interface Card {
  id: string;
  houseId: string;
  name: string;
  institution: string | null;
  lastFour: string | null;
  brand: string | null;
  /** Dono do cartao. Distinto de quem importou a fatura e de quem gastou. */
  ownerId: string | null;
  closingDay: number | null;
  dueDay: number | null;
  creditLimit: number | null;
  isActive: boolean;
}

export interface Category {
  id: string;
  houseId: string;
  name: string;
  color: string;
  icon: string | null;
  parentId: string | null;
  isActive: boolean;
}

export interface Installment {
  current: number;
  total: number;
  value: number | null;
}

export interface Transaction {
  id: string;
  houseId: string;
  invoiceId: string | null;
  cardId: string | null;
  /** Quem realizou o gasto. */
  memberId: string | null;

  date: IsoDate;
  invoiceMonth: MonthKey;

  description: string;
  merchantOriginal: string | null;
  merchantNormalized: string | null;
  merchantAlias: string | null;

  /** Sempre positivo. O sinal contabil vem de `type`. */
  amount: number;
  currency: string;
  originalAmount: number | null;
  originalCurrency: string | null;

  type: TransactionType;
  origin: TransactionOrigin;
  status: ForecastStatus;

  categoryId: string | null;
  subcategoryId: string | null;
  note: string | null;
  receiptUrl: string | null;

  visibility: Visibility;
  splitType: SplitType;
  splitPercentage: Record<string, number> | null;

  installment: Installment | null;
  recurringId: string | null;
  reconciledWithId: string | null;

  isHidden: boolean;
  isReconciled: boolean;

  /** Quem lancou. Distinto de `memberId`, que e quem gastou. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Recurrence {
  id: string;
  houseId: string;
  description: string;
  merchant: string | null;
  amount: number;
  categoryId: string | null;
  cardId: string | null;
  ownerId: string | null;
  interval: RecurrenceInterval;
  nextDate: IsoDate;
  expectedDay: number | null;
  isActive: boolean;
  source: "manual" | "detected";
}

export interface Budget {
  id: string;
  houseId: string;
  categoryId: string;
  month: MonthKey;
  limitAmount: number;
}

export interface Goal {
  id: string;
  houseId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: IsoDate | null;
  monthlyContribution: number | null;
  ownerId: string | null;
  note: string | null;
  status: GoalStatus;
}
