"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { listMembers } from "@/lib/houses";
import { listTransactions } from "@/data/queries";
import { DEFAULT_LISTS, moveColumn, reorder } from "@/domain/tasks";
import { addMonths, currentMonth } from "@/domain/month";
import { merchantLabel } from "@/domain/merchants";
import { spendingCents } from "@/domain/finance";
import { fromCents } from "@/lib/money";
import { DOS_DOIS } from "@/domain/schemas";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";

/**
 * O quadro de tarefas (secao 17): colunas, tarefas, e o elo com os
 * lancamentos.
 *
 * Toda acao confere a casa primeiro e filtra por ela. O banco confere de
 * novo: chaves compostas (id, house_id) impedem tarefa em coluna de outra
 * casa e elo com lancamento de outra casa - ver 20260926000002_tarefas.sql.
 */

const uuid = z.string().uuid();
const nome = z.string().trim().min(1, "Dê um nome.").max(60, "No máximo 60 caracteres.");

function revalidar() {
  revalidatePath("/tarefas");
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function contexto() {
  const [houseId, supabase] = await Promise.all([requireHouseId(), createClient()]);
  return { houseId, supabase };
}

function falha(onde: string, error: { code?: string } | null): FormState {
  console.error(`[tarefas] falha ao ${onde}`, { code: error?.code });
  return { error: `Não foi possível ${onde}.` };
}

// ---------------------------------------------------------------- colunas

/** Quadro novo: as tres colunas de partida - so se a casa ainda nao tem nenhuma. */
export async function createDefaultBoard(): Promise<FormState> {
  const { houseId, supabase } = await contexto();
  const { count } = await supabase
    .from("task_lists")
    .select("id", { count: "exact", head: true })
    .eq("house_id", houseId);
  if ((count ?? 0) > 0) return { ok: true };
  const { error } = await supabase
    .from("task_lists")
    .insert(DEFAULT_LISTS.map((name, position) => ({ house_id: houseId, name, position })));
  if (error) return falha("criar o quadro", error);
  revalidar();
  return { ok: true };
}

export async function createList(input: { name: string }): Promise<FormState> {
  const parsed = nome.safeParse(input.name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Nome inválido." };
  const { houseId, supabase } = await contexto();
  const { data: ultimas } = await supabase
    .from("task_lists")
    .select("position")
    .eq("house_id", houseId)
    .order("position", { ascending: false })
    .limit(1);
  const position = (Number(ultimas?.[0]?.position ?? -1) || 0) + 1;
  const { error } = await supabase.from("task_lists").insert({ house_id: houseId, name: parsed.data, position });
  if (error) return falha("criar a coluna", error);
  revalidar();
  return { ok: true };
}

export async function renameList(input: { id: string; name: string }): Promise<FormState> {
  const id = uuid.safeParse(input.id);
  const n = nome.safeParse(input.name);
  if (!id.success || !n.success) return { error: n.success ? "Coluna inválida." : (n.error.issues[0]?.message ?? "Nome inválido.") };
  const { houseId, supabase } = await contexto();
  const { error } = await supabase.from("task_lists").update({ name: n.data }).eq("id", id.data).eq("house_id", houseId);
  if (error) return falha("renomear a coluna", error);
  revalidar();
  return { ok: true };
}

export async function moveList(input: { id: string; direction: -1 | 1 }): Promise<FormState> {
  const id = uuid.safeParse(input.id);
  if (!id.success || (input.direction !== -1 && input.direction !== 1)) return { error: "Coluna inválida." };
  const { houseId, supabase } = await contexto();
  const { data, error } = await supabase
    .from("task_lists")
    .select("id, position, name")
    .eq("house_id", houseId)
    .order("position")
    .order("name");
  if (error) return falha("mover a coluna", error);
  const novas = moveColumn((data ?? []).map((l) => l.id as string), id.data, input.direction);
  const r = await gravarPosicoes(supabase, "task_lists", houseId, novas);
  if (r) return falha("mover a coluna", r);
  revalidar();
  return { ok: true };
}

/** Apagar a coluna leva as tarefas dela junto (o diálogo diz quantas). */
export async function deleteList(input: { id: string }): Promise<FormState> {
  const id = uuid.safeParse(input.id);
  if (!id.success) return { error: "Coluna inválida." };
  const { houseId, supabase } = await contexto();
  const { error } = await supabase.from("task_lists").delete().eq("id", id.data).eq("house_id", houseId);
  if (error) return falha("apagar a coluna", error);
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------- tarefas

export async function createTask(input: { listId: string; title: string }): Promise<FormState & { id?: string }> {
  const listId = uuid.safeParse(input.listId);
  const title = z.string().trim().min(1, "Escreva a tarefa.").max(200).safeParse(input.title);
  if (!listId.success) return { error: "Coluna inválida." };
  if (!title.success) return { error: title.error.issues[0]?.message ?? "Título inválido." };
  const [{ houseId, supabase }, user] = await Promise.all([contexto(), getCurrentUser()]);

  // No fim da coluna.
  const { data: ultimas } = await supabase
    .from("tasks")
    .select("position")
    .eq("house_id", houseId)
    .eq("list_id", listId.data)
    .order("position", { ascending: false })
    .limit(1);
  const position = ultimas && ultimas.length > 0 ? Number(ultimas[0]!.position) + 1 : 0;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      house_id: houseId,
      list_id: listId.data,
      title: title.data,
      position,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  // Coluna de outra casa: a chave composta recusa (23503).
  if (error || !data) return falha("criar a tarefa", error);
  revalidar();
  return { ok: true, id: data.id as string };
}

const editarSchema = z.object({
  id: uuid,
  title: z.string().trim().min(1, "Escreva a tarefa.").max(200),
  notes: z.string().trim().max(4000).nullable(),
  // Quem faz: um id de pessoa, "os dois", ou vazio.
  who: z.union([uuid, z.literal(DOS_DOIS), z.literal("")]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  expectedCents: z.number().int().min(0).max(100_000_000_00).nullable(),
  done: z.boolean(),
});

export async function updateTask(input: z.input<typeof editarSchema>): Promise<FormState> {
  const parsed = editarSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const p = parsed.data;
  const { houseId, supabase } = await contexto();

  let memberId: string | null = null;
  if (p.who !== "" && p.who !== DOS_DOIS) {
    const membros = await listMembers(houseId);
    if (!membros.some((m) => m.userId === p.who)) return { error: "Essa pessoa não é da casa." };
    memberId = p.who;
  }

  const { error } = await supabase
    .from("tasks")
    .update({
      title: p.title,
      notes: p.notes || null,
      member_id: memberId,
      is_joint: p.who === DOS_DOIS,
      due_date: p.dueDate,
      expected_amount: p.expectedCents === null ? null : fromCents(p.expectedCents),
      done: p.done,
    })
    .eq("id", p.id)
    .eq("house_id", houseId);
  if (error) return falha("salvar a tarefa", error);
  revalidar();
  return { ok: true };
}

export async function toggleTaskDone(input: { id: string; done: boolean }): Promise<FormState> {
  const id = uuid.safeParse(input.id);
  if (!id.success) return { error: "Tarefa inválida." };
  const { houseId, supabase } = await contexto();
  const { error } = await supabase.from("tasks").update({ done: input.done === true }).eq("id", id.data).eq("house_id", houseId);
  if (error) return falha("marcar a tarefa", error);
  revalidar();
  return { ok: true };
}

/** Leva a tarefa para a coluna `listId`, na posicao `index` dela. */
export async function moveTask(input: { id: string; listId: string; index: number }): Promise<FormState> {
  const id = uuid.safeParse(input.id);
  const listId = uuid.safeParse(input.listId);
  if (!id.success || !listId.success || !Number.isFinite(input.index)) return { error: "Movimento inválido." };
  const { houseId, supabase } = await contexto();

  // A coluna de destino tem de ser desta casa - a FK composta recusaria de
  // qualquer jeito, mas assim o erro e uma frase e nao um codigo.
  const { data: coluna } = await supabase.from("task_lists").select("id").eq("id", listId.data).eq("house_id", houseId).maybeSingle();
  if (!coluna) return { error: "Coluna não encontrada." };

  const { error: erroMover } = await supabase
    .from("tasks")
    .update({ list_id: listId.data })
    .eq("id", id.data)
    .eq("house_id", houseId);
  if (erroMover) return falha("mover a tarefa", erroMover);

  const { data: naColuna, error } = await supabase
    .from("tasks")
    .select("id, position")
    .eq("house_id", houseId)
    .eq("list_id", listId.data)
    .order("position");
  if (error) return falha("mover a tarefa", error);
  const r = await gravarPosicoes(
    supabase,
    "tasks",
    houseId,
    reorder((naColuna ?? []).map((t) => t.id as string), id.data, input.index),
  );
  if (r) return falha("mover a tarefa", r);
  revalidar();
  return { ok: true };
}

export async function deleteTask(input: { id: string }): Promise<FormState> {
  const id = uuid.safeParse(input.id);
  if (!id.success) return { error: "Tarefa inválida." };
  const { houseId, supabase } = await contexto();
  const { error } = await supabase.from("tasks").delete().eq("id", id.data).eq("house_id", houseId);
  if (error) return falha("apagar a tarefa", error);
  revalidar();
  return { ok: true };
}

/** So as posicoes que mudaram vao ao banco. */
async function gravarPosicoes(
  supabase: Supabase,
  tabela: "tasks" | "task_lists",
  houseId: string,
  posicoes: { id: string; position: number }[],
): Promise<{ code?: string } | null> {
  for (const p of posicoes) {
    const { error } = await supabase
      .from(tabela)
      .update({ position: p.position })
      .eq("id", p.id)
      .eq("house_id", houseId);
    if (error) return error;
  }
  return null;
}

// ---------------------------------------------------------------- gastos

export interface TransactionOption {
  id: string;
  date: string;
  label: string;
  cents: number;
}

/**
 * Lancamentos para ligar a uma tarefa: busca por texto nos ultimos 6 meses,
 * maiores primeiro. So despesas - uma tarefa liga o que se pagou por ela.
 */
export async function searchTransactionsForTask(input: { query: string }): Promise<{ options: TransactionOption[] }> {
  const q = z.string().trim().max(80).safeParse(input.query);
  const houseId = await requireHouseId();
  if (!q.success) return { options: [] };
  const hoje = currentMonth();
  const txs = await listTransactions(houseId, {
    fromMonth: addMonths(hoje, -6),
    toMonth: addMonths(hoje, 1),
    search: q.data || undefined,
    limit: 200,
  });
  return {
    options: txs
      .filter((t) => t.type === "expense" && !t.isHidden)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30)
      .map((t) => ({ id: t.id, date: t.date, label: merchantLabel(t), cents: spendingCents(t) })),
  };
}

export async function linkTransaction(input: { taskId: string; transactionId: string }): Promise<FormState> {
  const taskId = uuid.safeParse(input.taskId);
  const txId = uuid.safeParse(input.transactionId);
  if (!taskId.success || !txId.success) return { error: "Lançamento inválido." };
  const { houseId, supabase } = await contexto();
  // Tarefa e lancamento de outra casa: a chave composta recusa (23503), e o
  // upsert ignora o elo que ja existe.
  const { error } = await supabase
    .from("task_transactions")
    .upsert(
      { house_id: houseId, task_id: taskId.data, transaction_id: txId.data },
      { onConflict: "task_id,transaction_id", ignoreDuplicates: true },
    );
  if (error) return error.code === "23503" ? { error: "Lançamento não encontrado." } : falha("ligar o lançamento", error);
  revalidar();
  return { ok: true };
}

export async function unlinkTransaction(input: { taskId: string; transactionId: string }): Promise<FormState> {
  const taskId = uuid.safeParse(input.taskId);
  const txId = uuid.safeParse(input.transactionId);
  if (!taskId.success || !txId.success) return { error: "Lançamento inválido." };
  const { houseId, supabase } = await contexto();
  const { error } = await supabase
    .from("task_transactions")
    .delete()
    .eq("house_id", houseId)
    .eq("task_id", taskId.data)
    .eq("transaction_id", txId.data);
  if (error) return falha("desligar o lançamento", error);
  revalidar();
  return { ok: true };
}
