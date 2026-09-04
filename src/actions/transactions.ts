"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { z } from "zod";
import { transactionSchema } from "@/domain/schemas";
import { fromMonthKey } from "@/data/mappers";
import {
  fieldErrorsFrom,
  formToObject,
  requireHouseId,
  type FormState,
} from "./shared";

type Parsed = ReturnType<typeof transactionSchema.parse>;

function toRow(input: Parsed) {
  return {
    description: input.description,
    date: input.date,
    invoice_month: fromMonthKey(input.invoiceMonth),
    amount: input.amount,
    type: input.type,
    category_id: input.categoryId,
    subcategory_id: input.subcategoryId,
    member_id: input.memberId,
    card_id: input.cardId,
    visibility: input.visibility,
    split_type: input.splitType,
    note: input.note,
    merchant_alias: input.merchantAlias,
    installment_current: input.installmentCurrent,
    installment_total: input.installmentTotal,
    // Numa compra parcelada, o valor da parcela é o próprio valor lançado;
    // é o que aparece na fatura do mês.
    installment_value: input.installmentTotal === null ? null : input.amount,
  };
}

/**
 * Revalida tudo que depende de lançamento.
 *
 * A secao 9 exige que totais, gráficos, lista e orçamento atualizem
 * imediatamente após salvar - não basta atualizar a lista.
 */
function revalidateTransactions() {
  revalidatePath("/inicio");
  revalidatePath("/extratos");
  revalidatePath("/insights");
}

export async function createTransaction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = transactionSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { error } = await supabase.from("transactions").insert({
    house_id: houseId,
    origin: "manual",
    status: "confirmed",
    // Quem lançou. Distinto de member_id, que é quem gastou.
    created_by: user?.id ?? null,
    merchant_original: parsed.data.description,
    ...toRow(parsed.data),
  });

  if (error) {
    console.error("[lancamentos] falha ao criar", { code: error.code });
    return { error: "Não foi possível salvar o lançamento." };
  }

  revalidateTransactions();
  return { ok: true };
}

/**
 * Guarda "este estabelecimento é desta categoria" para a próxima importação.
 *
 * A tabela `learned_rules` já era lida pelo importador, mas nada no app
 * escrevia nela: a categorização automática por regra nunca podia acontecer,
 * porque regra nenhuma existia. Aprender aqui é o que faz a segunda
 * importação vir categorizada, sem inventar palpite na primeira.
 *
 * Falha em silêncio de propósito: a edição do lançamento é o que o usuário
 * pediu; não conseguir memorizar a regra não pode desfazê-la.
 */
async function learnCategoryRule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    description: string;
    categoryId: string | null;
    subcategoryId: string | null;
  },
): Promise<void> {
  if (input.categoryId === null) return;

  const houseId = await requireHouseId();
  const user = await getCurrentUser();
  // `normalized_pattern` é preenchido pelo trigger `learned_rules_fill`, com a
  // mesma normalização que o importador usa para comparar.
  const { error } = await supabase.from("learned_rules").upsert(
    {
      house_id: houseId,
      pattern: input.description,
      category_id: input.categoryId,
      subcategory_id: input.subcategoryId,
      created_by: user?.id ?? null,
    },
    { onConflict: "house_id,normalized_pattern" },
  );

  if (error) {
    console.error("[lancamentos] falha ao aprender a regra", {
      code: error.code,
    });
  }
}

export async function updateTransaction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = transactionSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const supabase = await createClient();
  // `origin` não é tocado: um lançamento vindo de fatura continua sendo de
  // fatura mesmo depois de editado, e a secao 13 exige distinguir a origem.
  const { error } = await supabase
    .from("transactions")
    .update(toRow(parsed.data))
    .eq("id", id);

  if (error) {
    console.error("[lancamentos] falha ao atualizar", { code: error.code });
    return { error: "Não foi possível salvar as alterações." };
  }

  await learnCategoryRule(supabase, parsed.data);

  revalidateTransactions();
  return { ok: true };
}

export async function deleteTransaction(id: string): Promise<FormState> {
  const supabase = await createClient();
  // O trigger de auditoria registra a exclusão com valor e descrição antes
  // de a linha sumir, então o histórico da secao 19 não perde o evento.
  const { error } = await supabase.from("transactions").delete().eq("id", id);

  if (error) {
    console.error("[lancamentos] falha ao excluir", { code: error.code });
    return { error: "Não foi possível excluir o lançamento." };
  }

  revalidateTransactions();
  return { ok: true };
}

/** Oculta ou reexibe um lançamento sem apagá-lo. */
export async function setTransactionHidden(
  id: string,
  hidden: boolean,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .update({ is_hidden: hidden })
    .eq("id", id);

  if (error) {
    console.error("[lancamentos] falha ao ocultar", { code: error.code });
    return { error: "Não foi possível alterar o lançamento." };
  }

  revalidateTransactions();
  return { ok: true };
}

/**
 * Troca a categoria de um lançamento direto na lista (secao 9).
 *
 * Existe para não obrigar a abrir o formulário inteiro só para categorizar:
 * depois de importar uma fatura são dezenas de linhas para classificar, e
 * catorze campos de diálogo por linha é trabalho que ninguém faz.
 *
 * Aceita tanto uma categoria quanto uma subcategoria: escolhendo uma filha, o
 * pai vai junto, porque `category_id` é o que os totais somam.
 */
export async function setTransactionCategory(
  transactionId: string,
  categoryId: string | null,
): Promise<{ error?: string }> {
  const parsed = z
    .object({
      transactionId: z.string().uuid(),
      categoryId: z.string().uuid().nullable(),
    })
    .safeParse({ transactionId, categoryId });
  if (!parsed.success) return { error: "Seleção inválida." };

  const houseId = await requireHouseId();
  const supabase = await createClient();

  // A categoria escolhida precisa ser da casa - o id vem do navegador.
  let parentId: string | null = null;
  let childId: string | null = null;

  if (parsed.data.categoryId !== null) {
    const { data: category, error } = await supabase
      .from("categories")
      .select("id, parent_id")
      .eq("house_id", houseId)
      .eq("id", parsed.data.categoryId)
      .maybeSingle();

    if (error || !category) return { error: "Categoria não encontrada." };

    const parent = category.parent_id as string | null;
    parentId = parent ?? (category.id as string);
    childId = parent ? (category.id as string) : null;
  }

  const { data: updated, error } = await supabase
    .from("transactions")
    .update({ category_id: parentId, subcategory_id: childId })
    .eq("id", parsed.data.transactionId)
    .select("description")
    .maybeSingle();

  if (error) {
    console.error("[lancamentos] falha ao trocar a categoria", {
      code: error.code,
    });
    return { error: "Não foi possível trocar a categoria." };
  }

  if (updated) {
    await learnCategoryRule(supabase, {
      description: String(updated.description),
      categoryId: parentId,
      subcategoryId: childId,
    });
  }

  revalidateTransactions();
  return {};
}
