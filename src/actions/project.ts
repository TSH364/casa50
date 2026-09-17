"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";

/**
 * Projetos: itens, cotações e compras (secao 15).
 *
 * "Projeto" e não "obra" porque a forma serve a qualquer coisa que se compre
 * por partes depois de juntar propostas — a reforma de agora, e o que vier
 * depois. O schema já dizia isso (`projects`); a tela é que dizia obra.
 *
 * Nada aqui grava resumo. Quantidade comprada, valor gasto e status saem da
 * soma das compras a cada leitura — ver `domain/project.ts`.
 */

const novoProjetoSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao projeto.").max(120),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function createProject(input: unknown): Promise<FormState & { id?: string }> {
  const parsed = novoProjetoSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .insert({
      house_id: houseId,
      name: parsed.data.name,
      started_on: parsed.data.startedOn ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[projetos] falha ao criar", { code: error.code });
    return { error: "Não foi possível criar o projeto." };
  }
  revalidatePath("/projetos");
  return { ok: true, id: data.id as string };
}

const itemSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1, "Dê um nome ao item.").max(160),
  stage: z.string().trim().max(60).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  plannedQuantity: z.number().positive().max(9_999_999).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function addProjectItem(input: unknown): Promise<FormState> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { error } = await supabase.from("project_items").insert({
    house_id: houseId,
    project_id: parsed.data.projectId,
    name: parsed.data.name,
    stage: parsed.data.stage || null,
    unit: parsed.data.unit || null,
    planned_quantity: parsed.data.plannedQuantity ?? null,
    note: parsed.data.note || null,
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[projetos] falha ao criar item", { code: error.code });
    return { error: "Não foi possível adicionar o item." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

const cotacaoSchema = z.object({
  itemId: z.string().uuid(),
  supplier: z.string().trim().min(1, "Diga de quem é a proposta.").max(120),
  amountCents: z.number().int().min(0).max(9_999_999_999),
  quantity: z.number().positive().max(9_999_999).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  quotedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function addQuote(input: unknown): Promise<FormState> {
  const parsed = cotacaoSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { error } = await supabase.from("project_quotes").insert({
    house_id: houseId,
    item_id: parsed.data.itemId,
    supplier: parsed.data.supplier,
    amount: parsed.data.amountCents / 100,
    quantity: parsed.data.quantity ?? null,
    note: parsed.data.note || null,
    quoted_on: parsed.data.quotedOn ?? null,
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[projetos] falha ao gravar cotacao", { code: error.code });
    return { error: "Não foi possível guardar a cotação." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

/**
 * Escolhe uma proposta, desmarcando a anterior do MESMO item.
 *
 * As duas escritas em ordem, e a limpeza primeiro: o banco tem índice único
 * de "uma escolhida por item", e marcar antes de desmarcar bateria nele.
 * Passar `null` em `quoteId` só desfaz a escolha.
 */
export async function chooseQuote(input: {
  itemId: string;
  quoteId: string | null;
}): Promise<FormState> {
  const schema = z.object({
    itemId: z.string().uuid(),
    quoteId: z.string().uuid().nullable(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const houseId = await requireHouseId();
  const supabase = await createClient();

  const { error: limpar } = await supabase
    .from("project_quotes")
    .update({ is_chosen: false })
    .eq("house_id", houseId)
    .eq("item_id", parsed.data.itemId)
    .eq("is_chosen", true);

  if (limpar) {
    console.error("[projetos] falha ao desmarcar cotacao", { code: limpar.code });
    return { error: "Não foi possível trocar a escolha." };
  }

  if (parsed.data.quoteId !== null) {
    const { error } = await supabase
      .from("project_quotes")
      .update({ is_chosen: true })
      .eq("house_id", houseId)
      .eq("id", parsed.data.quoteId)
      .eq("item_id", parsed.data.itemId);

    if (error) {
      console.error("[projetos] falha ao escolher cotacao", { code: error.code });
      return { error: "Não foi possível escolher esta proposta." };
    }
  }

  revalidatePath("/projetos");
  return { ok: true };
}

const compraSchema = z.object({
  itemId: z.string().uuid(),
  amountCents: z.number().int().min(0).max(9_999_999_999),
  quantity: z.number().positive().max(9_999_999).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplier: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** Lançamento do cartão, quando a compra passou por ele. */
  transactionId: z.string().uuid().nullable().optional(),
});

export async function addPurchase(input: unknown): Promise<FormState> {
  const parsed = compraSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { error } = await supabase.from("project_purchases").insert({
    house_id: houseId,
    item_id: parsed.data.itemId,
    transaction_id: parsed.data.transactionId ?? null,
    amount: parsed.data.amountCents / 100,
    quantity: parsed.data.quantity ?? null,
    date: parsed.data.date,
    supplier: parsed.data.supplier || null,
    note: parsed.data.note || null,
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[projetos] falha ao gravar compra", { code: error.code });
    return { error: "Não foi possível registrar a compra." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

export async function removePurchase(id: string): Promise<FormState> {
  if (!z.string().uuid().safeParse(id).success) return { error: "Dados inválidos." };
  const houseId = await requireHouseId();
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_purchases")
    .delete()
    .eq("house_id", houseId)
    .eq("id", id);

  if (error) {
    console.error("[projetos] falha ao remover compra", { code: error.code });
    return { error: "Não foi possível remover a compra." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

/**
 * Dá o item por encerrado, ou reabre.
 *
 * Existe porque sobra de material, troca de escopo e desconto no fim da obra
 * são normais: sem esta saída, um item que comprou 55 dos 60 ficaria parcial
 * até o fim da obra e viraria ruído permanente na lista.
 */
export async function setItemClosed(input: {
  itemId: string;
  closed: boolean;
}): Promise<FormState> {
  const schema = z.object({ itemId: z.string().uuid(), closed: z.boolean() });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const houseId = await requireHouseId();
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_items")
    .update({ closed_at: parsed.data.closed ? new Date().toISOString() : null })
    .eq("house_id", houseId)
    .eq("id", parsed.data.itemId);

  if (error) {
    console.error("[projetos] falha ao encerrar item", { code: error.code });
    return { error: "Não foi possível encerrar o item." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

export async function removeProjectItem(id: string): Promise<FormState> {
  if (!z.string().uuid().safeParse(id).success) return { error: "Dados inválidos." };
  const houseId = await requireHouseId();
  const supabase = await createClient();

  // As cotações e compras vão junto por `on delete cascade`: um item sem
  // dono deixaria histórico órfão que nenhuma tela alcança.
  const { error } = await supabase
    .from("project_items")
    .delete()
    .eq("house_id", houseId)
    .eq("id", id);

  if (error) {
    console.error("[projetos] falha ao remover item", { code: error.code });
    return { error: "Não foi possível remover o item." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}
