"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { fieldErrorsFrom, formToObject, requireHouseId } from "./shared";
import type { FormState } from "./shared";
import { parseAmount } from "@/lib/money";

/**
 * Recorrências (secao 10).
 *
 * Uma recorrência é uma expectativa, não um lançamento: ela diz o que deve
 * aparecer todo mês, e a conciliação confere se apareceu. Nada aqui cria
 * lançamento sozinho — inventar movimento que o banco não registrou seria
 * exatamente o tipo de dado falso que a secao 20 proíbe.
 */

const amountField = z
  .string()
  .transform((v) => parseAmount(v))
  .refine((v): v is number => v !== null, "Valor inválido.")
  .refine((v) => v >= 0, "O valor não pode ser negativo.")
  .refine((v) => v <= 99_999_999, "Valor alto demais.");

const recurrenceSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Descreva a recorrência.")
    .max(120, "No máximo 120 caracteres."),
  merchant: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : null)),
  amount: amountField,
  interval: z.enum(["weekly", "monthly", "yearly"]),
  expectedDay: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? Number(v) : null))
    .refine(
      (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 31),
      "Dia entre 1 e 31.",
    ),
  categoryId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
  cardId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
  ownerId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
});

/** Próxima ocorrência a partir de hoje, respeitando o dia esperado. */
function nextDateFrom(
  expectedDay: number | null,
  interval: "weekly" | "monthly" | "yearly",
  now = new Date(),
): string {
  if (interval !== "monthly" || expectedDay === null) {
    const d = new Date(now);
    d.setDate(d.getDate() + (interval === "weekly" ? 7 : 30));
    return d.toISOString().slice(0, 10);
  }

  const year = now.getFullYear();
  const month = now.getMonth();
  // Dia 31 num mês de 30: cai no último dia, em vez de virar o mês seguinte.
  const clampTo = (y: number, m: number) =>
    Math.min(expectedDay, new Date(y, m + 1, 0).getDate());

  const thisMonth = new Date(year, month, clampTo(year, month));
  if (thisMonth >= now) return thisMonth.toISOString().slice(0, 10);

  const next = new Date(year, month + 1, clampTo(year, month + 1));
  return next.toISOString().slice(0, 10);
}

export async function createRecurrence(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = recurrenceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();
  const d = parsed.data;

  const { error } = await supabase.from("recurrences").insert({
    house_id: houseId,
    description: d.description,
    merchant: d.merchant,
    amount: d.amount,
    category_id: d.categoryId,
    card_id: d.cardId,
    owner_id: d.ownerId,
    interval: d.interval,
    expected_day: d.expectedDay,
    next_date: nextDateFrom(d.expectedDay, d.interval),
    source: "manual",
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[recorrencias] falha ao criar", { code: error.code });
    return { error: "Não foi possível criar a recorrência." };
  }

  revalidatePath("/previsao");
  revalidatePath("/inicio");
  return { ok: true };
}

export async function updateRecurrence(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = recurrenceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const supabase = await createClient();
  const d = parsed.data;

  const { error } = await supabase
    .from("recurrences")
    .update({
      description: d.description,
      merchant: d.merchant,
      amount: d.amount,
      category_id: d.categoryId,
      card_id: d.cardId,
      owner_id: d.ownerId,
      interval: d.interval,
      expected_day: d.expectedDay,
      next_date: nextDateFrom(d.expectedDay, d.interval),
    })
    .eq("id", id);

  if (error) {
    console.error("[recorrencias] falha ao editar", { code: error.code });
    return { error: "Não foi possível salvar a recorrência." };
  }

  revalidatePath("/previsao");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Aceita uma recorrência que o sistema detectou no histórico (secao 10).
 *
 * A detecção sugere; quem decide é o casal. Ela entra com `source` marcado
 * como `detected`, para a tela poder dizer que aquela linha começou como
 * palpite do sistema e não como cadastro deliberado.
 */
const candidateSchema = z.object({
  description: z.string().trim().min(1).max(120),
  merchant: z.string().trim().max(120).nullable(),
  amountCents: z.number().int().min(0).max(9_999_999_999),
  expectedDay: z.number().int().min(1).max(31).nullable(),
  categoryId: z.string().uuid().nullable(),
  cardId: z.string().uuid().nullable(),
});

export async function acceptDetectedRecurrence(
  input: unknown,
): Promise<FormState> {
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) return { error: "Sugestão inválida." };

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();
  const d = parsed.data;

  const { error } = await supabase.from("recurrences").insert({
    house_id: houseId,
    description: d.description,
    merchant: d.merchant ?? d.description,
    amount: d.amountCents / 100,
    category_id: d.categoryId,
    card_id: d.cardId,
    owner_id: null,
    interval: "monthly",
    expected_day: d.expectedDay,
    next_date: nextDateFrom(d.expectedDay, "monthly"),
    source: "detected",
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[recorrencias] falha ao aceitar sugestao", {
      code: error.code,
    });
    return { error: "Não foi possível cadastrar a recorrência." };
  }

  revalidatePath("/previsao");
  return { ok: true };
}

export async function setRecurrenceActive(
  id: string,
  isActive: boolean,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("recurrences")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) {
    console.error("[recorrencias] falha ao pausar", { code: error.code });
    return { error: "Não foi possível alterar a recorrência." };
  }

  revalidatePath("/previsao");
  revalidatePath("/inicio");
  return { ok: true };
}

export async function deleteRecurrence(id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("recurrences").delete().eq("id", id);

  if (error) {
    console.error("[recorrencias] falha ao excluir", { code: error.code });
    return { error: "Não foi possível excluir a recorrência." };
  }

  revalidatePath("/previsao");
  revalidatePath("/inicio");
  return { ok: true };
}
