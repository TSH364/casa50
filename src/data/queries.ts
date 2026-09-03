import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  Budget,
  Card,
  Category,
  Goal,
  MonthKey,
  Recurrence,
  Transaction,
} from "@/domain/types";
import {
  BUDGET_COLUMNS,
  CARD_COLUMNS,
  CATEGORY_COLUMNS,
  GOAL_COLUMNS,
  RECURRENCE_COLUMNS,
  TRANSACTION_COLUMNS,
  fromMonthKey,
  mapBudget,
  mapCard,
  mapCategory,
  mapGoal,
  mapRecurrence,
  mapTransaction,
  toMonthKey,
} from "./mappers";

/**
 * Leitura de dados.
 *
 * Nenhuma funcao aqui filtra por `house_id` para efeito de seguranca - o RLS
 * ja restringe as linhas ao que o usuario pode ver. O `house_id` aparece
 * apenas quando o usuario participa de mais de uma casa e precisamos escolher
 * qual delas mostrar.
 *
 * Erros sao propagados, nunca engolidos: uma lista vazia por falha de rede e
 * indistinguivel de "nao ha dados", e a secao 20 exige estado de erro proprio.
 */

export class DataError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}

function fail(context: string, error: { message: string; code?: string }): never {
  // Só o codigo vai para o log - a mensagem do Postgres pode conter valores.
  console.error(`[dados] ${context}`, { code: error.code });
  throw new DataError(`Falha ao carregar ${context}.`, error.code);
}

export async function listCards(houseId: string): Promise<Card[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select(CARD_COLUMNS)
    .eq("house_id", houseId)
    .order("is_active", { ascending: false })
    .order("name");

  if (error) fail("os cartões", error);
  return (data ?? []).map(mapCard);
}

export async function getCard(cardId: string): Promise<Card | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select(CARD_COLUMNS)
    .eq("id", cardId)
    .maybeSingle();

  if (error) fail("o cartão", error);
  return data ? mapCard(data) : null;
}

export async function listCategories(houseId: string): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_COLUMNS)
    .eq("house_id", houseId)
    .eq("is_active", true)
    .order("sort_order")
    .order("name");

  if (error) fail("as categorias", error);
  return (data ?? []).map(mapCategory);
}

export interface TransactionFilter {
  month?: MonthKey;
  /** Intervalo inclusivo, alternativa a `month` - usado por previsões. */
  fromMonth?: MonthKey;
  toMonth?: MonthKey;
  memberId?: string | null;
  cardId?: string | null;
  /** Busca livre em descrição e estabelecimento. */
  search?: string;
  limit?: number;
}

export async function listTransactions(
  houseId: string,
  filter: TransactionFilter = {},
): Promise<Transaction[]> {
  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("house_id", houseId);

  if (filter.month) {
    query = query.eq("invoice_month", fromMonthKey(filter.month));
  }
  if (filter.fromMonth) {
    query = query.gte("invoice_month", fromMonthKey(filter.fromMonth));
  }
  if (filter.toMonth) {
    query = query.lte("invoice_month", fromMonthKey(filter.toMonth));
  }
  if (filter.memberId) query = query.eq("member_id", filter.memberId);
  if (filter.cardId) query = query.eq("card_id", filter.cardId);

  if (filter.search?.trim()) {
    // Escapa vírgula e parêntese, que são separadores da sintaxe `or` do
    // PostgREST e permitiriam alterar o filtro pela caixa de busca.
    const term = filter.search.trim().replace(/[,()]/g, " ");
    query = query.or(
      `description.ilike.%${term}%,merchant_original.ilike.%${term}%,merchant_alias.ilike.%${term}%`,
    );
  }

  const { data, error } = await query
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 500);

  if (error) fail("os lançamentos", error);
  return (data ?? []).map(mapTransaction);
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) fail("o lançamento", error);
  return data ? mapTransaction(data) : null;
}

/**
 * Meses que possuem algum lançamento, do mais recente para o mais antigo.
 *
 * A secao 7 exige que, quando o mes atual esta vazio, o app abra no ultimo
 * mes com dados em vez de mostrar uma tela vazia sem explicacao.
 */
export async function listMonthsWithData(houseId: string): Promise<MonthKey[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("invoice_month")
    .eq("house_id", houseId)
    .order("invoice_month", { ascending: false })
    .limit(2000);

  if (error) fail("os meses disponíveis", error);

  const seen = new Set<MonthKey>();
  for (const row of data ?? []) {
    seen.add(toMonthKey(row.invoice_month as string));
  }
  return [...seen];
}

// --------------------------------------------------------------------------
// Faturas importadas (secao 8)
// --------------------------------------------------------------------------

export interface InvoiceSummary {
  id: string;
  fileName: string | null;
  institution: string | null;
  invoiceMonth: MonthKey;
  format: string;
  status: string;
  reportedTotal: number | null;
  computedTotal: number;
  createdBy: string | null;
  createdAt: string;
  /** Quantos lançamentos ainda pertencem a esta importação. */
  transactionCount: number;
}

export async function listInvoices(
  houseId: string,
  month?: MonthKey,
): Promise<InvoiceSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select(
      "id, file_name, institution, invoice_month, format, status, reported_total, computed_total, created_by, created_at, transactions(count)",
    )
    .eq("house_id", houseId);

  if (month) query = query.eq("invoice_month", fromMonthKey(month));

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) fail("as faturas", error);

  return (data ?? []).map((row) => {
    // O count agregado do PostgREST vem como [{ count: n }].
    const counts = row.transactions as unknown as { count: number }[] | null;
    return {
      id: row.id as string,
      fileName: (row.file_name as string | null) ?? null,
      institution: (row.institution as string | null) ?? null,
      invoiceMonth: toMonthKey(row.invoice_month as string),
      format: row.format as string,
      status: row.status as string,
      reportedTotal:
        row.reported_total === null ? null : Number(row.reported_total),
      computedTotal: Number(row.computed_total ?? 0),
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: row.created_at as string,
      transactionCount: counts?.[0]?.count ?? 0,
    };
  });
}

// --------------------------------------------------------------------------
// Auditoria (secao 19)
// --------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  userId: string | null;
  entity: string;
  entityId: string | null;
  action: string;
  /** Texto humano montado pelo trigger. É o que a interface mostra. */
  summary: string | null;
  createdAt: string;
}

export interface AuditFilter {
  userId?: string | null;
  entity?: string | null;
  action?: string | null;
  limit?: number;
}

/**
 * Histórico legível.
 *
 * O JSON antes/depois fica no banco para rastreabilidade, mas não é lido
 * aqui: a secao 19 pede texto humano na interface, e trazer os dois blobs
 * por linha encheria a resposta com dados que a tela não usa.
 */
export async function listAuditLog(
  houseId: string,
  filter: AuditFilter = {},
): Promise<AuditEntry[]> {
  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("id, user_id, entity, entity_id, action, summary, created_at")
    .eq("house_id", houseId);

  if (filter.userId) query = query.eq("user_id", filter.userId);
  if (filter.entity) query = query.eq("entity", filter.entity);
  if (filter.action) query = query.eq("action", filter.action);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 200);

  if (error) fail("o histórico", error);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    entity: row.entity as string,
    entityId: (row.entity_id as string | null) ?? null,
    action: row.action as string,
    summary: (row.summary as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/** Totais por cartão no mês, para a visão de faturas da secao 8. */
export interface CardMonthTotal {
  cardId: string | null;
  totalCents: number;
  count: number;
}

// --------------------------------------------------------------------------
// Recorrencias, orcamentos e metas
// --------------------------------------------------------------------------

export async function listRecurrences(houseId: string): Promise<Recurrence[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurrences")
    .select(RECURRENCE_COLUMNS)
    .eq("house_id", houseId)
    .order("is_active", { ascending: false })
    .order("amount", { ascending: false });

  if (error) fail("as recorrências", error);
  return (data ?? []).map(mapRecurrence);
}

export async function listBudgets(
  houseId: string,
  month: MonthKey,
): Promise<Budget[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budgets")
    .select(BUDGET_COLUMNS)
    .eq("house_id", houseId)
    .eq("month", fromMonthKey(month));

  if (error) fail("os orçamentos", error);
  return (data ?? []).map(mapBudget);
}

export interface GoalDeposit {
  id: string;
  goalId: string;
  amount: number;
  date: string;
  memberId: string | null;
  note: string | null;
}

/**
 * Metas com o acumulado ja somado.
 *
 * O acumulado nao e coluna: e a soma dos depositos. Calcular aqui, num lugar
 * so, evita que uma tela mostre um total que os depositos nao sustentam.
 */
export async function listGoals(
  houseId: string,
): Promise<{ goals: Goal[]; deposits: GoalDeposit[] }> {
  const supabase = await createClient();

  const [goalsResult, depositsResult] = await Promise.all([
    supabase
      .from("goals")
      .select(GOAL_COLUMNS)
      .eq("house_id", houseId)
      .order("status")
      .order("created_at", { ascending: false }),
    supabase
      .from("goal_deposits")
      .select("id, goal_id, amount, date, member_id, note")
      .eq("house_id", houseId)
      .order("date", { ascending: false }),
  ]);

  if (goalsResult.error) fail("as metas", goalsResult.error);
  if (depositsResult.error) fail("os depósitos", depositsResult.error);

  const deposits: GoalDeposit[] = (depositsResult.data ?? []).map((row) => ({
    id: row.id as string,
    goalId: row.goal_id as string,
    amount: Number(row.amount),
    date: String(row.date).slice(0, 10),
    memberId: (row.member_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
  }));

  const totals = new Map<string, number>();
  for (const d of deposits) {
    totals.set(d.goalId, (totals.get(d.goalId) ?? 0) + d.amount);
  }

  return {
    goals: (goalsResult.data ?? []).map((row) =>
      mapGoal(row, totals.get(row.id as string) ?? 0),
    ),
    deposits,
  };
}
