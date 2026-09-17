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

const itemDaPlanilhaSchema = z.object({
  name: z.string().trim().min(1).max(160),
  stage: z.string().trim().max(60).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  plannedQuantity: z.number().positive().max(9_999_999).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** Fornecedor e valor viram UMA cotação, quando os dois vêm juntos. */
  supplier: z.string().trim().max(120).nullable().optional(),
  amountCents: z.number().int().min(0).max(9_999_999_999).nullable().optional(),
});

const importarItensSchema = z.object({
  projectId: z.string().uuid(),
  // O teto é do tamanho de uma planilha de obra, não de um banco de dados: mais
  // que isso é engano de arquivo, e o limite diz isso antes de gravar.
  items: z.array(itemDaPlanilhaSchema).min(1).max(500),
});

export interface ImportResult extends FormState {
  created?: number;
  quotes?: number;
  /** Itens que o projeto já tinha, com o mesmo nome e a mesma etapa. */
  duplicates?: string[];
}

/**
 * Grava de uma vez os itens que vieram de uma planilha (secao 15).
 *
 * O QUE CHEGA AQUI JÁ FOI CONFERIDO NA TELA: o arquivo é aberto no navegador e
 * a pessoa vê linha por linha antes de mandar. O servidor não lê planilha.
 *
 * NÃO REGRAVA O QUE JÁ EXISTE. Subir a mesma planilha duas vezes — porque a
 * primeira falhou no meio, porque a aba estava errada, porque o celular
 * recarregou — é o caminho mais provável até aqui, e duplicar quinze itens de
 * obra é o tipo de estrago que só se descobre na hora de somar. A comparação é
 * por nome e etapa, sem acento e sem caixa, que é como a pessoa lê "Piso
 * Vinilico" e "piso vinílico": o mesmo item.
 *
 * O preço da planilha vira COTAÇÃO, e não campo do item: previsto sai de
 * proposta, e uma proposta tem sempre de quem ela é. Linha sem fornecedor ou
 * sem valor entra como item sem cotação — que é a verdade sobre um item que
 * ainda não foi cotado.
 */
export async function importProjectItems(input: unknown): Promise<ImportResult> {
  const parsed = importarItensSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { data: existentes, error: erroExistentes } = await supabase
    .from("project_items")
    .select("name, stage, sort_order")
    .eq("house_id", houseId)
    .eq("project_id", parsed.data.projectId);

  if (erroExistentes) {
    console.error("[projetos] falha ao conferir itens", { code: erroExistentes.code });
    return { error: "Não foi possível conferir o que o projeto já tem." };
  }

  const chave = (name: string, stage?: string | null) =>
    `${name}|${stage ?? ""}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const jaTem = new Set(
    (existentes ?? []).map((r) => chave(r.name as string, r.stage as string | null)),
  );
  // Continua de onde a lista parou, para a ordem da planilha sobreviver a uma
  // segunda importação.
  let ordem = Math.max(0, ...(existentes ?? []).map((r) => Number(r.sort_order) || 0));

  const duplicates: string[] = [];
  const novos: typeof parsed.data.items = [];
  for (const item of parsed.data.items) {
    const k = chave(item.name, item.stage);
    if (jaTem.has(k)) {
      duplicates.push(item.name);
      continue;
    }
    // Contra duplicata DENTRO do próprio arquivo, e não só contra o banco: uma
    // aba de resumo repete o mesmo material em dois blocos.
    jaTem.add(k);
    novos.push(item);
  }

  if (novos.length === 0) {
    return { ok: true, created: 0, quotes: 0, duplicates };
  }

  const { data: gravados, error } = await supabase
    .from("project_items")
    .insert(
      novos.map((item) => ({
        house_id: houseId,
        project_id: parsed.data.projectId,
        name: item.name,
        stage: item.stage || null,
        unit: item.unit || null,
        planned_quantity: item.plannedQuantity ?? null,
        note: item.note || null,
        sort_order: (ordem += 1),
        created_by: user?.id ?? null,
      })),
    )
    .select("id, name, stage");

  if (error || !gravados) {
    console.error("[projetos] falha ao importar itens", { code: error?.code });
    return { error: "Não foi possível gravar os itens da planilha." };
  }

  // Casa cada cotação ao seu item PELO NOME, e não pela posição na lista: a
  // ordem das linhas devolvidas por um insert em lote é detalhe do banco, e
  // apostar nela erraria de um jeito que ninguém veria — o preço do porcelanato
  // no item da tinta, com o fornecedor errado junto.
  const idPorChave = new Map(
    gravados.map((row) => [chave(row.name as string, row.stage as string | null), row.id as string]),
  );

  const cotacoes = novos
    .map((item) => ({ id: idPorChave.get(chave(item.name, item.stage)), item }))
    .filter((p) => p.id && p.item.supplier && (p.item.amountCents ?? 0) > 0)
    .map((p) => ({
      house_id: houseId,
      item_id: p.id as string,
      supplier: p.item.supplier as string,
      amount: (p.item.amountCents as number) / 100,
      quantity: p.item.plannedQuantity ?? null,
      note: "Preço de referência da planilha",
      created_by: user?.id ?? null,
    }));

  let quotes = 0;
  if (cotacoes.length > 0) {
    const { error: erroCotacoes } = await supabase
      .from("project_quotes")
      .insert(cotacoes);
    if (erroCotacoes) {
      // Os itens já entraram, e dizer "não foi possível" apagaria isso da tela
      // sem apagar do banco. O número que volta é o que de fato aconteceu.
      console.error("[projetos] falha ao importar cotações", {
        code: erroCotacoes.code,
      });
    } else {
      quotes = cotacoes.length;
    }
  }

  revalidatePath("/projetos");
  return { ok: true, created: gravados.length, quotes, duplicates };
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
