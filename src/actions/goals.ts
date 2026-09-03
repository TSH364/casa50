"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { fieldErrorsFrom, formToObject, requireHouseId } from "./shared";
import type { FormState } from "./shared";
import { parseAmount } from "@/lib/money";

/**
 * Metas e depósitos (secao 13).
 *
 * O acumulado de uma meta é sempre a soma dos depósitos — nunca um campo
 * editável. Um número que pode ser digitado à mão deixa de ser verificável,
 * e a meta perde o sentido de mostrar progresso real.
 */

const amountField = z
  .string()
  .transform((v) => parseAmount(v))
  .refine((v): v is number => v !== null, "Valor inválido.")
  .refine((v) => v > 0, "O valor precisa ser maior que zero.")
  .refine((v) => v <= 99_999_999, "Valor alto demais.");

const goalSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Dê um nome à meta.")
    .max(120, "No máximo 120 caracteres."),
  targetAmount: amountField,
  targetDate: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? v : null))
    .refine(
      (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
      "Data inválida.",
    ),
  monthlyContribution: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? parseAmount(v) : null))
    .refine((v) => v === null || (v !== null && v >= 0), "Valor inválido."),
  ownerId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function createGoal(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = goalSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();
  const d = parsed.data;

  const { error } = await supabase.from("goals").insert({
    house_id: houseId,
    name: d.name,
    target_amount: d.targetAmount,
    target_date: d.targetDate,
    monthly_contribution: d.monthlyContribution,
    owner_id: d.ownerId,
    note: d.note,
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[metas] falha ao criar", { code: error.code });
    return { error: "Não foi possível criar a meta." };
  }

  revalidatePath("/metas");
  return { ok: true };
}

export async function updateGoal(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = goalSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const supabase = await createClient();
  const d = parsed.data;

  const { error } = await supabase
    .from("goals")
    .update({
      name: d.name,
      target_amount: d.targetAmount,
      target_date: d.targetDate,
      monthly_contribution: d.monthlyContribution,
      owner_id: d.ownerId,
      note: d.note,
    })
    .eq("id", id);

  if (error) {
    console.error("[metas] falha ao editar", { code: error.code });
    return { error: "Não foi possível salvar a meta." };
  }

  revalidatePath("/metas");
  return { ok: true };
}

export async function setGoalStatus(
  id: string,
  status: string,
): Promise<FormState> {
  const parsed = z.enum(["active", "completed", "paused", "cancelled"]).safeParse(status);
  if (!parsed.success) return { error: "Situação inválida." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .update({ status: parsed.data })
    .eq("id", id);

  if (error) {
    console.error("[metas] falha ao mudar situacao", { code: error.code });
    return { error: "Não foi possível alterar a meta." };
  }

  revalidatePath("/metas");
  return { ok: true };
}

export async function deleteGoal(id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("goals").delete().eq("id", id);

  if (error) {
    console.error("[metas] falha ao excluir", { code: error.code });
    return { error: "Não foi possível excluir a meta." };
  }

  revalidatePath("/metas");
  return { ok: true };
}

const depositSchema = z.object({
  goalId: z.string().uuid(),
  amount: z
    .string()
    .transform((v) => parseAmount(v))
    .refine((v): v is number => v !== null && v !== 0, "Valor inválido.")
    .refine((v) => Math.abs(v) <= 99_999_999, "Valor alto demais."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  memberId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
});

/**
 * Registra um aporte. Valor negativo é retirada — a secao 13 pede que o
 * histórico mostre também o que saiu, em vez de só somar entradas.
 */
export async function addGoalDeposit(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = depositSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();
  const d = parsed.data;

  const { error } = await supabase.from("goal_deposits").insert({
    house_id: houseId,
    goal_id: d.goalId,
    amount: d.amount,
    date: d.date,
    member_id: d.memberId,
    note: d.note,
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[metas] falha ao depositar", { code: error.code });
    return { error: "Não foi possível registrar o aporte." };
  }

  revalidatePath("/metas");
  return { ok: true };
}

export async function deleteGoalDeposit(id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("goal_deposits").delete().eq("id", id);

  if (error) {
    console.error("[metas] falha ao excluir aporte", { code: error.code });
    return { error: "Não foi possível excluir o aporte." };
  }

  revalidatePath("/metas");
  return { ok: true };
}
