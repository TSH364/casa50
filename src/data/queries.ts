import "server-only";
import { spendingCents, withoutExcludedCategories } from "@/domain/finance";
import { buildBoard } from "@/domain/tasks";
import { savedAnalysisSchema, type AiAnalysis } from "@/domain/ai-insights";
import { merchantLabel } from "@/domain/merchants";
import type { BoardColumn, LinkedTransaction, Task, TaskList } from "@/domain/tasks";
import { createClient } from "@/lib/supabase/server";
import type { ProjectItem } from "@/domain/project";
import type {
  Budget,
  Project,
  CalendarEvent,
  CalendarSource,
  Card,
  Category,
  Goal,
  IsoDate,
  MonthKey,
  Recurrence,
  Transaction,
} from "@/domain/types";
import {
  BUDGET_COLUMNS,
  CALENDAR_EVENT_COLUMNS,
  CALENDAR_SOURCE_COLUMNS,
  CARD_COLUMNS,
  CATEGORY_COLUMNS,
  GOAL_COLUMNS,
  PROJECT_COLUMNS,
  PROJECT_ITEM_COLUMNS,
  PROJECT_PURCHASE_COLUMNS,
  PROJECT_QUOTE_COLUMNS,
  RECURRENCE_COLUMNS,
  TRANSACTION_COLUMNS,
  fromMonthKey,
  mapBudget,
  mapCalendarEvent,
  mapCalendarSource,
  mapCard,
  mapCategory,
  mapGoal,
  mapProject,
  mapProjectItemRow,
  mapProjectPurchase,
  mapProjectQuote,
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
  /** Categoria-pai. Inclui os lançamentos marcados na subcategoria dela. */
  categoryId?: string | null;
  /** Busca livre em descrição e estabelecimento. */
  search?: string;
  /**
   * Categorias que não contam nos totais da casa.
   *
   * O corte acontece aqui, e em nenhum outro lugar: se cada tela filtrasse por
   * conta própria, uma acabaria esquecida e os números deixariam de bater
   * entre si - foi exatamente assim que o total da fatura já saiu negativo
   * uma vez, com duas cópias da mesma regra divergindo.
   *
   * Lançamento sem categoria nunca é excluído: ausência de categoria não é o
   * mesmo que pertencer a uma categoria excluída.
   */
  excludeCategoryIds?: readonly string[];
  limit?: number;
}

/** O teto de linhas por resposta do PostgREST no Supabase. */
const PAGINA_POSTGREST = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `belongsToMember`, escrita como filtro do PostgREST.
 *
 * Dos dois, OU marcado com a pessoa, OU sem ninguem marcado num cartao dela.
 * Tem de dar exatamente a mesma resposta que a regra do dominio: a lista vem
 * daqui, e o total ao lado dela, de la.
 *
 * `null` quando o id nao e um uuid - ele vem da URL (`?membro=`), e texto
 * livre dentro de um `or` poderia reescrever o filtro.
 */
export function memberOrFilter(
  memberId: string,
  cardOwners: ReadonlyMap<string, string | null>,
): string | null {
  if (!UUID.test(memberId)) return null;
  const partes = [`is_joint.is.true`, `member_id.eq.${memberId}`];
  const cartoes = [...cardOwners]
    .filter(([id, dono]) => dono === memberId && UUID.test(id))
    .map(([id]) => id);
  if (cartoes.length > 0) {
    partes.push(`and(member_id.is.null,card_id.in.(${cartoes.join(",")}))`);
  }
  return partes.join(",");
}

export async function listTransactions(
  houseId: string,
  filter: TransactionFilter = {},
): Promise<Transaction[]> {
  const supabase = await createClient();

  // Dono de cada cartao: decide de quem e o lancamento que ninguem marcou
  // (ver `belongsToMember`). Uma consulta pequena - a casa tem poucos cartoes.
  const { data: cartoes, error: cartoesError } = await supabase
    .from("cards")
    .select("id, owner_id")
    .eq("house_id", houseId);
  if (cartoesError) fail("os cartões", cartoesError);
  const donoDoCartao = new Map(
    (cartoes ?? []).map((c) => [c.id as string, (c.owner_id as string | null) ?? null]),
  );

  // Id que nao e uuid nao e de ninguem: vem da URL, e nao pode virar texto
  // dentro do filtro `or` do PostgREST.
  const filtroPessoa = filter.memberId ? memberOrFilter(filter.memberId, donoDoCartao) : null;
  if (filter.memberId && filtroPessoa === null) return [];

  // Monta a consulta do zero a cada pagina: o construtor do Supabase e
  // consumido quando e aguardado, e nao pode ser reaproveitado.
  const montar = () => {
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
    if (filtroPessoa) query = query.or(filtroPessoa);
    if (filter.cardId) query = query.eq("card_id", filter.cardId);
    // "sem" é o recorte que mais importa depois de importar uma fatura: é a
    // lista do que ainda falta categorizar.
    if (filter.categoryId === "sem") query = query.is("category_id", null);
    else if (filter.categoryId) query = query.eq("category_id", filter.categoryId);

    if (filter.search?.trim()) {
      // Escapa vírgula e parêntese, que são separadores da sintaxe `or` do
      // PostgREST e permitiriam alterar o filtro pela caixa de busca.
      const term = filter.search.trim().replace(/[,()]/g, " ");
      query = query.or(
        `description.ilike.%${term}%,merchant_original.ilike.%${term}%,merchant_alias.ilike.%${term}%`,
      );
    }
    return query
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      // Desempate estavel: sem ele, duas linhas do mesmo dia e horario podem
      // trocar de lugar entre uma pagina e outra, e uma aparece duas vezes.
      .order("id", { ascending: false });
  };

  // Em paginas de 1.000: o PostgREST do Supabase corta CADA resposta nesse
  // numero, sem avisar. MEDIDO: a casa tem ~120 lancamentos por mes, entao
  // os 12 meses que o Inicio le passavam de 1.400 - e os meses mais antigos
  // sumiam das medias e do mapa de fluxo, sem erro nenhum.
  const limite = filter.limit ?? 500;
  const data: Record<string, unknown>[] = [];
  let error: { code?: string; message: string } | null = null;
  for (let de = 0; de < limite; de += PAGINA_POSTGREST) {
    const ate = Math.min(de + PAGINA_POSTGREST, limite) - 1;
    const pagina = await montar().range(de, ate);
    if (pagina.error) {
      error = pagina.error;
      break;
    }
    data.push(...((pagina.data ?? []) as Record<string, unknown>[]));
    if ((pagina.data ?? []).length < ate - de + 1) break;
  }

  if (error) fail("os lançamentos", error);
  const rows = (data ?? []).map((row) => {
    const t = mapTransaction(row);
    t.cardOwnerId = t.cardId ? (donoDoCartao.get(t.cardId) ?? null) : null;
    return t;
  });

  // O corte é feito em memória, e não como filtro no PostgREST: em SQL,
  // `category_id NOT IN (...)` descarta em silêncio as linhas com categoria
  // nula. A regra mora no domínio, onde tem teste.
  return withoutExcludedCategories(rows, filter.excludeCategoryIds ?? []);
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

export async function listCalendarSources(
  houseId: string,
): Promise<CalendarSource[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_sources")
    .select(CALENDAR_SOURCE_COLUMNS)
    .eq("house_id", houseId)
    .order("created_at", { ascending: true });

  if (error) fail("as agendas", error);
  return (data ?? []).map(mapCalendarSource);
}

/**
 * Eventos que ENCOSTAM no intervalo.
 *
 * Nao basta o inicio estar dentro: uma viagem de 28/12 a 04/01 pertence
 * tambem a janela de janeiro, e filtrar so por `starts_on` a perderia.
 */
export async function listCalendarEvents(
  houseId: string,
  range: { from: IsoDate; to: IsoDate },
): Promise<CalendarEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .select(CALENDAR_EVENT_COLUMNS)
    .eq("house_id", houseId)
    .gte("ends_on", range.from)
    .lte("starts_on", range.to)
    .order("starts_on", { ascending: true })
    .limit(2000);

  if (error) fail("os eventos da agenda", error);
  return (data ?? []).map(mapCalendarEvent);
}

/**
 * Propostas de subcategoria que a casa ja recusou.
 *
 * Devolve chaves `categoria|proposta` para a tela filtrar. Se a consulta
 * falhar - tabela ainda nao migrada, por exemplo - devolve vazio em vez de
 * derrubar a pagina: sem as recusas a tela mostra sugestao demais, o que e
 * chato; sem a pagina, a casa perde o gerenciador de categorias inteiro.
 */
export async function listSubcategoryDismissals(
  houseId: string,
): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subcategory_dismissals")
    .select("category_id, suggestion_key")
    .eq("house_id", houseId);

  if (error) {
    console.error("[categorias] falha ao ler as recusas", { code: error.code });
    return new Set();
  }
  return new Set(
    (data ?? []).map((r) => `${r.category_id}|${r.suggestion_key}`),
  );
}

/**
 * Quantas despesas de cada categoria ainda estao sem subcategoria.
 *
 * Contagem no banco (`head: true`), e nao lista: e so o numero que a tela de
 * categorias mostra ao lado do botao do Jev.
 */
export async function countWithoutSubcategory(
  houseId: string,
  categoryIds: readonly string[],
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const pares = await Promise.all(
    categoryIds.map(async (id) => {
      const { count, error } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("house_id", houseId)
        .eq("category_id", id)
        .eq("type", "expense")
        .is("subcategory_id", null);
      if (error) {
        console.error("[categorias] falha ao contar", { code: error.code });
        return [id, 0] as const;
      }
      return [id, count ?? 0] as const;
    }),
  );
  return new Map(pares);
}

/**
 * Quem aparece nos lancamentos de cada cartao que ainda nao tem dono.
 *
 * Serve a SUGESTAO em Cartoes ("parece ser do Vini"), e nada mais: o dono so
 * muda quando alguem confirma. Sugere so quando uma pessoa so aparece no
 * cartao - com duas, nao ha dono evidente, e chutar seria pior que perguntar.
 */
export async function suggestCardOwners(
  houseId: string,
): Promise<Map<string, { memberId: string; count: number }>> {
  const supabase = await createClient();
  const { data: cartoes } = await supabase
    .from("cards")
    .select("id")
    .eq("house_id", houseId)
    .is("owner_id", null);
  const semDono = (cartoes ?? []).map((c) => c.id as string);
  const sugestoes = new Map<string, { memberId: string; count: number }>();
  if (semDono.length === 0) return sugestoes;

  const { data, error } = await supabase
    .from("transactions")
    .select("card_id, member_id")
    .eq("house_id", houseId)
    .in("card_id", semDono)
    .not("member_id", "is", null)
    .limit(5000);
  if (error) {
    console.error("[cartoes] falha ao sugerir donos", { code: error.code });
    return sugestoes;
  }

  const porCartao = new Map<string, Map<string, number>>();
  for (const r of data ?? []) {
    const pessoas = porCartao.get(r.card_id as string) ?? new Map<string, number>();
    pessoas.set(r.member_id as string, (pessoas.get(r.member_id as string) ?? 0) + 1);
    porCartao.set(r.card_id as string, pessoas);
  }
  for (const [cardId, pessoas] of porCartao) {
    if (pessoas.size !== 1) continue;
    const [memberId, count] = [...pessoas][0]!;
    sugestoes.set(cardId, { memberId, count });
  }
  return sugestoes;
}

// --------------------------------------------------------------------------
// Projetos (secao 15)
// --------------------------------------------------------------------------

/**
 * Os projetos ativos da casa, do mais novo para o mais antigo.
 *
 * Lista, e nao "o projeto ativo": a forma serve a qualquer coisa que se
 * compre por partes depois de juntar propostas, e mais de uma dessas pode
 * estar em curso ao mesmo tempo.
 */
export async function listProjects(houseId: string): Promise<Project[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("house_id", houseId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) fail("os projetos", error);
  return (data ?? []).map(mapProject);
}

/**
 * Os itens da obra ja com cotacoes e compras dentro.
 *
 * Tres consultas em paralelo e a juncao em memoria, e nao um `select`
 * aninhado: as listas crescem por caminhos diferentes - uma cotacao a mais
 * nao mexe nas compras - e separadas cada tela pode reler so o que mudou.
 */
export async function listProjectItems(
  houseId: string,
  projectId: string,
): Promise<ProjectItem[]> {
  const supabase = await createClient();
  const [itens, cotacoes, compras] = await Promise.all([
    supabase
      .from("project_items")
      .select(PROJECT_ITEM_COLUMNS)
      .eq("house_id", houseId)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("project_quotes")
      .select(PROJECT_QUOTE_COLUMNS)
      .eq("house_id", houseId)
      .order("amount", { ascending: true }),
    supabase
      .from("project_purchases")
      .select(PROJECT_PURCHASE_COLUMNS)
      .eq("house_id", houseId)
      .order("date", { ascending: true }),
  ]);

  if (itens.error) fail("os itens do projeto", itens.error);
  if (cotacoes.error) fail("as cotações", cotacoes.error);
  if (compras.error) fail("as compras do projeto", compras.error);

  const porItem = new Map<string, ProjectItem>();
  for (const row of itens.data ?? []) {
    const base = mapProjectItemRow(row);
    porItem.set(base.id, { ...base, quotes: [], purchases: [] });
  }
  for (const row of cotacoes.data ?? []) {
    const q = mapProjectQuote(row);
    porItem.get(q.itemId)?.quotes.push(q);
  }
  for (const row of compras.data ?? []) {
    const p = mapProjectPurchase(row);
    porItem.get(p.itemId)?.purchases.push(p);
  }
  return [...porItem.values()];
}

// --------------------------------------------------------------------------
// Tarefas (secao 17)
// --------------------------------------------------------------------------

/**
 * O quadro de tarefas: colunas, tarefas e os lancamentos ligados a cada uma.
 *
 * Tres leituras e a juncao em memoria, como os projetos. O gasto de cada
 * tarefa sai dos lancamentos ligados, com a mesma regra de sinal das telas
 * (`spendingCents`: estorno desconta).
 */
export async function getTaskBoard(houseId: string): Promise<BoardColumn[]> {
  const supabase = await createClient();
  const [listas, tarefas, elos] = await Promise.all([
    supabase.from("task_lists").select("id, name, position").eq("house_id", houseId),
    supabase
      .from("tasks")
      .select("id, list_id, title, notes, position, member_id, is_joint, due_date, expected_amount, done")
      .eq("house_id", houseId),
    supabase.from("task_transactions").select("task_id, transaction_id").eq("house_id", houseId),
  ]);
  if (listas.error) fail("as colunas", listas.error);
  if (tarefas.error) fail("as tarefas", tarefas.error);
  if (elos.error) fail("os lançamentos das tarefas", elos.error);

  const ids = [...new Set((elos.data ?? []).map((e) => e.transaction_id as string))];
  const lancamentos = new Map<string, LinkedTransaction>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("transactions")
      .select(TRANSACTION_COLUMNS)
      .eq("house_id", houseId)
      .in("id", ids);
    if (error) fail("os lançamentos das tarefas", error);
    for (const row of data ?? []) {
      const t = mapTransaction(row);
      lancamentos.set(t.id, { id: t.id, date: t.date, label: merchantLabel(t), cents: spendingCents(t) });
    }
  }

  const porTarefa = new Map<string, LinkedTransaction[]>();
  for (const e of elos.data ?? []) {
    const l = lancamentos.get(e.transaction_id as string);
    if (!l) continue;
    const k = e.task_id as string;
    porTarefa.set(k, [...(porTarefa.get(k) ?? []), l]);
  }

  const tasks: Task[] = (tarefas.data ?? []).map((r) => ({
    id: r.id as string,
    listId: r.list_id as string,
    title: String(r.title),
    notes: (r.notes as string | null) ?? null,
    position: Number(r.position),
    memberId: (r.member_id as string | null) ?? null,
    isJoint: r.is_joint === true,
    dueDate: (r.due_date as string | null) ?? null,
    expectedCents: r.expected_amount === null ? null : Math.round(Number(r.expected_amount) * 100),
    done: r.done === true,
    linked: (porTarefa.get(r.id as string) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
  }));
  const lists: TaskList[] = (listas.data ?? []).map((l) => ({
    id: l.id as string,
    name: String(l.name),
    position: Number(l.position),
  }));
  return buildBoard(lists, tasks);
}

// --------------------------------------------------------------------------
// Analise do mes com IA (secao 14)
// --------------------------------------------------------------------------

export interface SavedAiAnalysis {
  items: AiAnalysis[];
  dropped: number;
  model: string | null;
  createdAt: string;
}

/**
 * A analise mais recente do mes, no recorte pedido. Conteudo que nao passa no
 * schema (versao antiga, linha estragada) conta como "sem analise": a tela
 * oferece fazer de novo em vez de quebrar.
 */
export async function getLatestAiAnalysis(
  houseId: string,
  month: MonthKey,
  scope: "casa" | "tudo",
): Promise<SavedAiAnalysis | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .select("content, model, created_at")
    .eq("house_id", houseId)
    .eq("month", month)
    .eq("scope", scope)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("a análise do mês", error);
  if (!data) return null;
  const content = savedAnalysisSchema.safeParse(data.content);
  if (!content.success) return null;
  return {
    ...content.data,
    model: (data.model as string | null) ?? null,
    createdAt: String(data.created_at),
  };
}
