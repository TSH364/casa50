"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cardSchema } from "@/domain/schemas";
import { CARD_COLUMNS, mapCard } from "@/data/mappers";
import type { Card } from "@/domain/types";
import {
  fieldErrorsFrom,
  formToObject,
  requireHouseId,
  type FormState,
} from "./shared";

function toRow(input: ReturnType<typeof cardSchema.parse>) {
  return {
    name: input.name,
    institution: input.institution,
    last_four: input.lastFour,
    brand: input.brand,
    owner_id: input.ownerId,
    closing_day: input.closingDay,
    due_day: input.dueDay,
    credit_limit: input.creditLimit,
  };
}

/** Revalida tudo que exibe cartão ou total por cartão. */
function revalidateCards() {
  revalidatePath("/cartoes");
  revalidatePath("/inicio");
  revalidatePath("/extratos");
}

/**
 * Cria um cartão a partir do final que veio na fatura (secao 6).
 *
 * Existe porque a importação sabe que o arquivo tem os cartões 2150, 6869 e
 * 0162, e obrigar o usuário a sair da tela, cadastrar três cartões à mão e
 * recomeçar a importação é trabalho que o app pode poupar. O nome é
 * provisório: `/cartoes` deixa renomear.
 */
export async function createCardFromLastFour(
  lastFour: string,
): Promise<{ error?: string; card?: Card }> {
  if (!/^\d{4}$/.test(lastFour)) {
    return { error: "Final de cartão inválido." };
  }

  const houseId = await requireHouseId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .insert({ house_id: houseId, name: `Cartão ${lastFour}`, last_four: lastFour })
    .select(CARD_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[cartoes] falha ao criar pelo final", { code: error?.code });
    return { error: "Não foi possível criar o cartão." };
  }

  revalidateCards();
  revalidatePath("/importar");
  // O cartão inteiro volta para a tela de importação inserir no seletor sem
  // recarregar a página - recarregar perderia o arquivo já lido.
  return { card: mapCard(data) };
}

export async function createCard(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = cardSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const houseId = await requireHouseId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("cards")
    .insert({ house_id: houseId, ...toRow(parsed.data) });

  if (error) {
    console.error("[cartoes] falha ao criar", { code: error.code });
    return { error: "Não foi possível salvar o cartão." };
  }

  revalidateCards();
  return { ok: true };
}

export async function updateCard(
  cardId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = cardSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("cards")
    .update(toRow(parsed.data))
    .eq("id", cardId);

  if (error) {
    console.error("[cartoes] falha ao atualizar", { code: error.code });
    return { error: "Não foi possível salvar as alterações." };
  }

  revalidateCards();
  return { ok: true };
}

/**
 * Arquiva o cartao em vez de excluir.
 *
 * Excluir de verdade deixaria os lancamentos historicos sem cartao
 * (`on delete set null`), perdendo a informacao de onde a compra aconteceu.
 * Arquivar preserva o historico e some com o cartao das listas de escolha.
 */
export async function archiveCard(cardId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cards")
    .update({ is_active: false })
    .eq("id", cardId);

  if (error) {
    console.error("[cartoes] falha ao arquivar", { code: error.code });
    return { error: "Não foi possível arquivar o cartão." };
  }

  revalidateCards();
  return { ok: true };
}

export async function restoreCard(cardId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cards")
    .update({ is_active: true })
    .eq("id", cardId);

  if (error) {
    console.error("[cartoes] falha ao restaurar", { code: error.code });
    return { error: "Não foi possível restaurar o cartão." };
  }

  revalidateCards();
  return { ok: true };
}

/**
 * Exclusao definitiva. Só permitida quando o cartão não tem lançamento
 * nenhum - caso contrário o histórico ficaria órfão e a exclusão seria
 * irreversível sem aviso.
 */
export async function deleteCard(cardId: string): Promise<FormState> {
  const supabase = await createClient();

  const { count, error: countError } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("card_id", cardId);

  if (countError) {
    console.error("[cartoes] falha ao contar lancamentos", { code: countError.code });
    return { error: "Não foi possível verificar os lançamentos do cartão." };
  }

  if ((count ?? 0) > 0) {
    return {
      error: `Este cartão tem ${count} lançamento(s). Arquive-o para preservar o histórico.`,
    };
  }

  const { error } = await supabase.from("cards").delete().eq("id", cardId);
  if (error) {
    console.error("[cartoes] falha ao excluir", { code: error.code });
    return { error: "Não foi possível excluir o cartão." };
  }

  revalidateCards();
  return { ok: true };
}
