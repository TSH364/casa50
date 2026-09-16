"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";
import { fromMonthKey } from "@/data/mappers";
import { isMonthKey } from "@/domain/month";
import { addMonths, monthRange } from "@/domain/month";
import { suggestBudget, totalsByCategory } from "@/domain/finance";
import { listTransactions } from "@/data/queries";
import { houseView } from "@/lib/house-view";

/**
 * Orçamentos por categoria e mês (secao 12).
 *
 * O orçamento é do mês, não da categoria: mudar o limite de dezembro não
 * mexe em novembro. Isso permite ajustar um mês atípico sem reescrever a
 * história — e é por isso que a chave é (categoria, mês).
 */

const setSchema = z.object({
  categoryId: z.string().uuid(),
  month: z.string().refine(isMonthKey, "Mês inválido."),
  limitCents: z
    .number()
    .int()
    .min(0, "O limite não pode ser negativo.")
    .max(9_999_999_999),
});

/**
 * Define o limite. Zero remove — é o mesmo gesto do ponto de vista de quem
 * usa ("não quero orçamento aqui") e evita um botão separado de excluir.
 */
export async function setBudget(input: unknown): Promise<FormState> {
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { categoryId, month, limitCents } = parsed.data;

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  if (limitCents === 0) {
    const { error } = await supabase
      .from("budgets")
      .delete()
      .eq("house_id", houseId)
      .eq("category_id", categoryId)
      .eq("month", fromMonthKey(month));

    if (error) {
      console.error("[orcamentos] falha ao remover", { code: error.code });
      return { error: "Não foi possível remover o orçamento." };
    }
    revalidatePath("/orcamentos");
    revalidatePath("/inicio");
    return { ok: true };
  }

  // `upsert` na unique (house_id, category_id, month): redefinir o limite do
  // mesmo mês substitui, em vez de criar uma segunda linha.
  const { error } = await supabase.from("budgets").upsert(
    {
      house_id: houseId,
      category_id: categoryId,
      month: fromMonthKey(month),
      limit_amount: limitCents / 100,
      created_by: user?.id ?? null,
    },
    { onConflict: "house_id,category_id,month" },
  );

  if (error) {
    console.error("[orcamentos] falha ao gravar", { code: error.code });
    return { error: "Não foi possível salvar o orçamento." };
  }

  revalidatePath("/orcamentos");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Copia os limites do mês anterior (secao 12).
 *
 * Não sobrescreve o que já existe: se o casal já definiu dezembro, copiar
 * novembro por cima apagaria uma decisão deliberada.
 */
export async function copyBudgetsFromPreviousMonth(
  month: string,
): Promise<FormState & { copied?: number }> {
  if (!isMonthKey(month)) return { error: "Mês inválido." };

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();
  const previous = addMonths(month, -1);

  const [{ data: source }, { data: existing }] = await Promise.all([
    supabase
      .from("budgets")
      .select("category_id, limit_amount")
      .eq("house_id", houseId)
      .eq("month", fromMonthKey(previous)),
    supabase
      .from("budgets")
      .select("category_id")
      .eq("house_id", houseId)
      .eq("month", fromMonthKey(month)),
  ]);

  const taken = new Set((existing ?? []).map((b) => b.category_id as string));
  const rows = (source ?? [])
    .filter((b) => !taken.has(b.category_id as string))
    .map((b) => ({
      house_id: houseId,
      category_id: b.category_id as string,
      month: fromMonthKey(month),
      limit_amount: b.limit_amount as number,
      created_by: user?.id ?? null,
    }));

  if (rows.length === 0) {
    return {
      ok: true,
      copied: 0,
      error:
        (source ?? []).length === 0
          ? "O mês anterior não tem orçamentos para copiar."
          : undefined,
    };
  }

  const { error } = await supabase.from("budgets").insert(rows);
  if (error) {
    console.error("[orcamentos] falha ao copiar", { code: error.code });
    return { error: "Não foi possível copiar os orçamentos." };
  }

  revalidatePath("/orcamentos");
  revalidatePath("/inicio");
  return { ok: true, copied: rows.length };
}

const applySchema = z.object({
  month: z.string().refine(isMonthKey, "Mês inválido."),
  changes: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        limitCents: z.number().int().min(0).max(9_999_999_999),
      }),
    )
    .min(1, "Nada para aplicar.")
    .max(50),
});

/**
 * Aplica de uma vez a realocacao proposta pela agenda (secao 12, camada 3).
 *
 * E tudo ou nada de proposito: a proposta so faz sentido inteira. Aceitar
 * metade dela liberaria metade do dinheiro para uma viagem que vai acontecer
 * por completo, e o casal ficaria com um combinado que nao fecha.
 */
export async function applyBudgetChanges(input: unknown): Promise<FormState & { applied?: number }> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { month, changes } = parsed.data;

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const removals = changes.filter((c) => c.limitCents === 0).map((c) => c.categoryId);
  const upserts = changes
    .filter((c) => c.limitCents > 0)
    .map((c) => ({
      house_id: houseId,
      category_id: c.categoryId,
      month: fromMonthKey(month),
      limit_amount: c.limitCents / 100,
      created_by: user?.id ?? null,
    }));

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("budgets")
      .upsert(upserts, { onConflict: "house_id,category_id,month" });
    if (error) {
      console.error("[orcamentos] falha ao aplicar realocação", { code: error.code });
      return { error: "Não foi possível aplicar a realocação." };
    }
  }

  if (removals.length > 0) {
    const { error } = await supabase
      .from("budgets")
      .delete()
      .eq("house_id", houseId)
      .eq("month", fromMonthKey(month))
      .in("category_id", removals);
    if (error) {
      console.error("[orcamentos] falha ao remover na realocação", { code: error.code });
      return { error: "Não foi possível aplicar a realocação." };
    }
  }

  revalidatePath("/orcamentos");
  revalidatePath("/inicio");
  revalidatePath("/previsao");
  return { ok: true, applied: changes.length };
}

/**
 * Cria de uma vez os limites que o app ja sabia sugerir (secao 12).
 *
 * POR QUE EXISTE: a sugestao por categoria ja estava na tela, com um "usar"
 * ao lado de cada linha. O que faltava era fazer isso de uma vez - MEDIDO na
 * casa real, doze categorias tem sugestao, e o caminho era clicar, digitar e
 * salvar doze vezes. O resultado dessa friccao estava no banco: ZERO
 * orcamentos, com nove faturas de historico disponiveis.
 *
 * A MEDIA E RECALCULADA AQUI, e nao recebida pronta do navegador. E a mesma
 * disciplina da importacao com a subcategoria: um numero que o cliente manda
 * e um numero que o cliente pode forjar, e este vira teto de gasto da casa.
 *
 * NUNCA sobrescreve limite existente. Quem ja definiu um teto decidiu, e uma
 * media do historico passando por cima apagaria a decisao - mesma regra que
 * `copyBudgetsFromPreviousMonth` segue.
 */
export async function applySuggestedBudgets(
  month: string,
): Promise<FormState & { created?: number }> {
  if (!isMonthKey(month)) return { error: "Mês inválido." };

  const houseId = await requireHouseId();
  const [user, view] = await Promise.all([getCurrentUser(), houseView(houseId)]);
  const supabase = await createClient();

  // A mesma janela que a tela usa para propor: os tres meses ANTERIORES.
  const historyFrom = addMonths(month, -3);
  const [history, { data: existing }] = await Promise.all([
    listTransactions(houseId, {
      fromMonth: historyFrom,
      toMonth: addMonths(month, -1),
      excludeCategoryIds: view.excludeCategoryIds,
      limit: 2000,
    }),
    supabase
      .from("budgets")
      .select("category_id")
      .eq("house_id", houseId)
      .eq("month", fromMonthKey(month)),
  ]);

  // Total de cada categoria em cada mes, separadamente: a media precisa dos
  // meses um a um, e nao da soma da janela inteira.
  const porCategoria = new Map<string, number[]>();
  for (const past of monthRange(historyFrom, addMonths(month, -1))) {
    for (const total of totalsByCategory(history, past)) {
      if (total.categoryId === null) continue;
      const lista = porCategoria.get(total.categoryId) ?? [];
      lista.push(total.totalCents);
      porCategoria.set(total.categoryId, lista);
    }
  }

  const jaTem = new Set((existing ?? []).map((b) => b.category_id as string));
  // So categoria-mae recebe orcamento: limitar mae e filha ao mesmo tempo
  // criaria dois numeros concorrentes para o mesmo gasto.
  const rows = view.categories
    .filter((c) => c.parentId === null && !jaTem.has(c.id))
    .map((c) => ({ c, limite: suggestBudget(porCategoria.get(c.id) ?? []) }))
    .filter((r): r is { c: (typeof view.categories)[number]; limite: number } =>
      r.limite !== null,
    )
    .map((r) => ({
      house_id: houseId,
      category_id: r.c.id,
      month: fromMonthKey(month),
      limit_amount: r.limite / 100,
      created_by: user?.id ?? null,
    }));

  if (rows.length === 0) {
    return {
      ok: true,
      created: 0,
      error: jaTem.size > 0
        ? undefined
        : "Ainda não há três meses de histórico para sugerir limites.",
    };
  }

  const { error } = await supabase.from("budgets").insert(rows);
  if (error) {
    console.error("[orcamentos] falha ao aplicar sugestoes", { code: error.code });
    return { error: "Não foi possível criar os orçamentos." };
  }

  revalidatePath("/orcamentos");
  revalidatePath("/inicio");
  return { ok: true, created: rows.length };
}
