"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fieldErrorsFrom, formToObject, requireHouseId } from "./shared";
import type { FormState } from "./shared";

/**
 * Categorias da casa (secao 5).
 *
 * As categorias iniciais são semeadas pelo trigger de criação da casa, mas
 * não têm nenhum estatuto especial: podem ser renomeadas, recoloridas e
 * removidas como qualquer outra. Nada no código trata nome de categoria como
 * constante.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Dê um nome à categoria.")
    .max(60, "No máximo 60 caracteres."),
  color: z
    .string()
    .trim()
    .regex(HEX, "Cor inválida.")
    .default("#8B8B94"),
  parentId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export async function createCategory(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = formToObject(formData);
  const parsed = categorySchema.safeParse({
    ...raw,
    parentId: raw.parentId || null,
  });
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const houseId = await requireHouseId();
  const supabase = await createClient();

  // Uma subcategoria não pode ter subcategoria: dois níveis bastam para o
  // uso doméstico e uma árvore mais funda complicaria todo o agrupamento.
  if (parsed.data.parentId) {
    const { data: parent } = await supabase
      .from("categories")
      .select("parent_id")
      .eq("id", parsed.data.parentId)
      .maybeSingle();
    if (parent?.parent_id) {
      return { error: "Uma subcategoria não pode conter outra subcategoria." };
    }
  }

  const { error } = await supabase.from("categories").insert({
    house_id: houseId,
    name: parsed.data.name,
    color: parsed.data.color,
    parent_id: parsed.data.parentId,
  });

  if (error) {
    console.error("[categorias] falha ao criar", { code: error.code });
    return { error: "Não foi possível criar a categoria." };
  }

  revalidatePath("/categorias");
  revalidatePath("/inicio");
  return { ok: true };
}

export async function updateCategory(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = categorySchema
    .omit({ parentId: true })
    .safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ name: parsed.data.name, color: parsed.data.color })
    .eq("id", id);

  if (error) {
    console.error("[categorias] falha ao editar", { code: error.code });
    return { error: "Não foi possível salvar a categoria." };
  }

  revalidatePath("/categorias");
  revalidatePath("/inicio");
  revalidatePath("/extratos");
  return { ok: true };
}

/**
 * Quantos lançamentos usam a categoria - a tela mostra antes de excluir.
 *
 * Excluir não apaga lançamento nenhum: a chave estrangeira é
 * `on delete set null`, então os lançamentos ficam sem categoria e continuam
 * somando no total do mês.
 */
export async function countCategoryUsage(
  id: string,
): Promise<{ transactions: number; budgets: number; children: number }> {
  const supabase = await createClient();
  const [tx, budgets, children] = await Promise.all([
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .or(`category_id.eq.${id},subcategory_id.eq.${id}`),
    supabase
      .from("budgets")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id),
    supabase
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", id),
  ]);

  return {
    transactions: tx.count ?? 0,
    budgets: budgets.count ?? 0,
    children: children.count ?? 0,
  };
}

export async function deleteCategory(id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);

  if (error) {
    console.error("[categorias] falha ao excluir", { code: error.code });
    return { error: "Não foi possível excluir a categoria." };
  }

  revalidatePath("/categorias");
  revalidatePath("/inicio");
  revalidatePath("/extratos");
  return { ok: true };
}
