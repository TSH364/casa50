"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
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
