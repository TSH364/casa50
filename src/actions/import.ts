"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import { fromMonthKey } from "@/data/mappers";
import {
  categoryFromHint,
  categoryFromMerchant,
  duplicateKey,
  normalizeMerchant,
} from "@/importers/detect";
import { isMonthKey } from "@/domain/month";
import { fromCents } from "@/lib/money";
import { spendingOfCents } from "@/domain/finance";
import type {
  DraftTransaction,
  ImportSummary,
  ReviewedDraft,
} from "@/importers/types";

/**
 * Gravação da importação (secao 6).
 *
 * O arquivo é lido no navegador; o que chega aqui são as linhas já
 * interpretadas. Mesmo assim tudo é revalidado com Zod: o cliente é apenas
 * uma conveniência, nunca a fonte de verdade.
 */

const draftSchema = z.object({
  row: z.number().int().nonnegative(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invoiceMonth: z.string().refine(isMonthKey),
  description: z.string().trim().min(1).max(300),
  merchantOriginal: z.string().max(300),
  merchantNormalized: z.string().max(300),
  amountCents: z.number().int().min(0).max(9_999_999_999),
  type: z.enum(["expense", "income", "payment", "refund", "fee", "adjustment"]),
  categoryHint: z.string().max(120).nullable(),
  categoryId: z.string().uuid().nullable(),
  cardLastFour: z.string().regex(/^\d{4}$/).nullable(),
  cardId: z.string().uuid().nullable(),
  installmentCurrent: z.number().int().min(1).max(99).nullable(),
  installmentTotal: z.number().int().min(1).max(99).nullable(),
  duplicateKey: z.string().max(600),
});

const reviewSchema = z.object({
  drafts: z.array(draftSchema).min(1, "Nenhuma linha para importar.").max(5000),
  invoiceMonth: z.string().refine(isMonthKey),
  cardId: z.string().uuid().nullable(),
  memberId: z.string().uuid().nullable(),
});

export interface ReviewResult {
  error?: string;
  reviewed?: ReviewedDraft[];
  summary?: ImportSummary;
  /** Avisos que a revisão descobriu só ao cruzar com o banco. */
  notes?: string[];
}

function summarize(
  reviewed: readonly ReviewedDraft[],
  reportedTotalCents: number | null,
): ImportSummary {
  const toImport = reviewed.filter((d) => d.decision === "new");
  // Mesma regra de sinal das telas (`spendingCents`), e não uma cópia: o
  // pagamento da fatura anterior conta zero, porque quitação não é gasto do
  // mês. Subtraí-lo fazia a fatura do Itaú fechar em -R$ 1.022,78 enquanto a
  // lista de lançamentos, na mesma tela, mostrava R$ 17.129,13.
  const computed = toImport.reduce(
    (sum, d) => sum + spendingOfCents(d.type, d.amountCents),
    0,
  );

  return {
    total: reviewed.length,
    new: toImport.length,
    duplicates: reviewed.filter((d) => d.decision === "duplicate").length,
    ignored: reviewed.filter((d) => d.decision === "ignored").length,
    withoutCategory: toImport.filter((d) => d.categoryId === null).length,
    computedTotalCents: computed,
    reportedTotalCents,
    divergenceCents:
      reportedTotalCents === null ? null : reportedTotalCents - computed,
  };
}

/**
 * Tudo que a casa sabe sobre categorias, no formato em que a decisão precisa.
 *
 * Carregado uma vez por operação e passado adiante: a resolução roda por
 * lançamento, e ir ao banco a cada linha seria uma consulta por compra.
 */
interface CategoryMaps {
  ruleByPattern: Map<string, string | null>;
  byName: Map<string, string>;
  nameById: Map<string, string>;
}

async function loadCategoryMaps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  houseId: string,
): Promise<CategoryMaps> {
  const [{ data: rules }, { data: categories }] = await Promise.all([
    supabase
      .from("learned_rules")
      .select("normalized_pattern, category_id")
      .eq("house_id", houseId),
    supabase
      .from("categories")
      .select("id, name")
      .eq("house_id", houseId)
      .eq("is_active", true),
  ]);

  return {
    ruleByPattern: new Map(
      (rules ?? []).map((r) => [
        String(r.normalized_pattern),
        r.category_id as string | null,
      ]),
    ),
    byName: new Map(
      (categories ?? []).map((c) => [
        normalizeMerchant(String(c.name)),
        c.id as string,
      ]),
    ),
    nameById: new Map(
      (categories ?? []).map((c) => [c.id as string, String(c.name)]),
    ),
  };
}

/**
 * Em que categoria este lançamento cai, e por quê.
 *
 * Ordem por confiança, da maior para a menor:
 *
 * 1. regra aprendida - a casa já disse, à mão, onde isto vai;
 * 2. nome do estabelecimento - "ELETROGRAAL" é recarga de carro elétrico,
 *    independente do que o banco ache;
 * 3. categoria do arquivo, traduzida - cobre o que a tabela não conhece;
 * 4. tipo do lançamento - só serve para tarifa.
 *
 * O nome da loja vem ANTES da dica do banco de propósito: a do banco sai do
 * ramo cadastrado na maquininha e erra muito. Numa fatura real ela chamava
 * supermercado de "Associação" e restaurante de "Supermercados".
 *
 * Uma função só, usada pela importação e pela reanálise, para as duas não
 * divergirem - foi assim que o total da fatura já saiu errado antes.
 */
function resolveCategoryId(
  input: {
    merchantNormalized: string;
    categoryHint: string | null;
    type: string;
  },
  maps: CategoryMaps,
): string | null {
  const byName = (name: string | null) =>
    name ? maps.byName.get(normalizeMerchant(name)) : undefined;

  const fromRule = maps.ruleByPattern.get(input.merchantNormalized);
  const fromMerchant = byName(categoryFromMerchant(input.merchantNormalized));
  const fromHint = input.categoryHint
    ? (byName(input.categoryHint) ?? byName(categoryFromHint(input.categoryHint)))
    : undefined;
  const fromType = input.type === "fee" ? maps.byName.get("TARIFAS") : undefined;

  return fromRule ?? fromMerchant ?? fromHint ?? fromType ?? null;
}

/**
 * Confronta as linhas lidas com o que já existe no banco.
 *
 * A comparação usa a mesma identidade da secao 6 - mês, data, estabelecimento
 * normalizado, valor, cartão e parcela. Nunca só descrição e valor: a mesma
 * assinatura em meses diferentes é compra legítima, não repetição.
 */
export async function reviewImport(
  input: unknown,
): Promise<ReviewResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { drafts, invoiceMonth, cardId } = parsed.data;

  const houseId = await requireHouseId();
  const supabase = await createClient();
  const notes: string[] = [];

  // Existentes do mesmo mês: é o único recorte em que pode haver repetição.
  const { data: existing, error: existingError } = await supabase
    .from("transactions")
    .select(
      "id, date, merchant_normalized, amount, card_id, installment_current, installment_total",
    )
    .eq("house_id", houseId)
    .eq("invoice_month", fromMonthKey(invoiceMonth));

  if (existingError) {
    console.error("[importacao] falha ao buscar existentes", {
      code: existingError.code,
    });
    return { error: "Não foi possível verificar duplicidades." };
  }

  const existingByKey = new Map<string, string>();
  for (const row of existing ?? []) {
    const key = duplicateKey({
      invoiceMonth,
      date: String(row.date).slice(0, 10),
      merchantNormalized: String(row.merchant_normalized ?? ""),
      amountCents: Math.round(Number(row.amount) * 100),
      cardId: row.card_id as string | null,
      installmentCurrent: row.installment_current as number | null,
      installmentTotal: row.installment_total as number | null,
    });
    if (!existingByKey.has(key)) existingByKey.set(key, row.id as string);
  }

  const maps = await loadCategoryMaps(supabase, houseId);

  // Repetições dentro do próprio arquivo também precisam aparecer.
  const seenInFile = new Set<string>();
  let autoCategorized = 0;

  const reviewed: ReviewedDraft[] = drafts.map((draft) => {
    // O cartão da linha vence o cartão escolhido para o arquivo todo: uma
    // fatura do Itaú traz titular e adicionais no mesmo CSV.
    const rowCardId = draft.cardId ?? cardId;
    const key = duplicateKey({
      invoiceMonth,
      date: draft.date,
      merchantNormalized: draft.merchantNormalized,
      amountCents: draft.amountCents,
      cardId: rowCardId,
      installmentCurrent: draft.installmentCurrent,
      installmentTotal: draft.installmentTotal,
    });

    let categoryId = draft.categoryId;
    if (categoryId === null) {
      categoryId = resolveCategoryId(draft, maps);
      if (categoryId !== null) autoCategorized += 1;
    }

    const existingId = existingByKey.get(key);
    const repeatedInFile = seenInFile.has(key);
    seenInFile.add(key);

    return {
      ...draft,
      invoiceMonth,
      categoryId,
      // O nome vai junto para a revisão mostrar em que categoria cada linha
      // vai cair: palpite que ninguém vê é palpite que ninguém corrige.
      categoryName: categoryId ? (maps.nameById.get(categoryId) ?? null) : null,
      cardId: rowCardId,
      duplicateKey: key,
      decision: existingId || repeatedInFile ? "duplicate" : "new",
      ...(existingId ? { duplicateOfId: existingId } : {}),
    };
  });

  if (autoCategorized > 0) {
    notes.push(
      `${autoCategorized} lançamento(s) categorizados automaticamente pelo estabelecimento, por regra aprendida ou pela categoria do arquivo. Confira abaixo antes de gravar.`,
    );
  }
  const dupes = reviewed.filter((d) => d.decision === "duplicate").length;
  if (dupes > 0) {
    notes.push(
      `${dupes} possível(is) repetição(ões). Confira antes de confirmar — a mesma compra pode aparecer legitimamente duas vezes.`,
    );
  }
  const semCategoria = reviewed.filter(
    (d) => d.decision === "new" && d.categoryId === null,
  ).length;
  if (semCategoria > 0) {
    notes.push(
      `${semCategoria} lançamento(s) sem categoria. Dá para categorizar depois, no extrato.`,
    );
  }
  const semCartao = reviewed.filter(
    (d) => d.decision === "new" && d.cardId === null,
  ).length;
  if (semCartao > 0) {
    notes.push(
      `${semCartao} lançamento(s) sem cartão associado. Dá para associar depois, no extrato.`,
    );
  }

  return { reviewed, summary: summarize(reviewed, null), notes };
}

const commitSchema = reviewSchema.extend({
  drafts: z
    .array(draftSchema.extend({ decision: z.enum(["new", "duplicate", "ignored"]) }))
    .min(1)
    .max(5000),
  fileName: z.string().max(255),
  fileHash: z.string().max(128).nullable(),
  institution: z.string().max(80).nullable(),
  format: z.enum(["csv", "xlsx", "pdf"]),
  reportedTotalCents: z.number().int().nullable(),
});

export interface CommitResult {
  error?: string;
  invoiceId?: string;
  summary?: ImportSummary;
}

/** Grava a importação. Só as linhas marcadas como `new` viram lançamento. */
export async function commitImport(input: unknown): Promise<CommitResult> {
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const toImport = data.drafts.filter((d) => d.decision === "new");
  if (toImport.length === 0) {
    return { error: "Nenhuma linha nova para importar." };
  }

  const summary = summarize(
    data.drafts as ReviewedDraft[],
    data.reportedTotalCents,
  );

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      house_id: houseId,
      card_id: data.cardId,
      file_name: data.fileName,
      institution: data.institution,
      invoice_month: fromMonthKey(data.invoiceMonth),
      reported_total: data.reportedTotalCents === null
        ? null
        : fromCents(data.reportedTotalCents),
      computed_total: fromCents(summary.computedTotalCents),
      status: "imported",
      format: data.format,
      file_hash: data.fileHash,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (invoiceError || !invoice) {
    // A unique parcial em (house_id, file_hash) barra reimportar o mesmo
    // arquivo; vale uma mensagem específica em vez do erro cru.
    if (invoiceError?.code === "23505") {
      return { error: "Este arquivo já foi importado nesta casa." };
    }
    console.error("[importacao] falha ao criar fatura", {
      code: invoiceError?.code,
    });
    return { error: "Não foi possível registrar a importação." };
  }

  const rows = toImport.map((d) => ({
    house_id: houseId,
    invoice_id: invoice.id,
    card_id: d.cardId ?? data.cardId,
    member_id: data.memberId,
    date: d.date,
    invoice_month: fromMonthKey(data.invoiceMonth),
    description: d.description,
    merchant_original: d.merchantOriginal,
    amount: fromCents(d.amountCents),
    type: d.type,
    origin: "invoice" as const,
    status: "confirmed" as const,
    category_id: d.categoryId,
    visibility: "shared" as const,
    installment_current: d.installmentCurrent,
    installment_total: d.installmentTotal,
    installment_value:
      d.installmentTotal === null ? null : fromCents(d.amountCents),
    created_by: user?.id ?? null,
  }));

  const { error: rowsError } = await supabase.from("transactions").insert(rows);

  if (rowsError) {
    console.error("[importacao] falha ao gravar lancamentos", {
      code: rowsError.code,
    });
    // Sem os lançamentos a fatura não representa nada: desfaz para não
    // deixar um registro de importação vazio no histórico.
    await supabase.from("invoices").delete().eq("id", invoice.id);
    return { error: "Não foi possível gravar os lançamentos. Nada foi importado." };
  }

  revalidatePath("/inicio");
  revalidatePath("/extratos");
  revalidatePath("/importar");

  return { invoiceId: invoice.id, summary };
}

/**
 * Reanalisa uma fatura já importada, sem apagar nada.
 *
 * O leitor melhora com o tempo - uma tabela de estabelecimentos nova, uma
 * regra que a casa acabou de ensinar - e sem isto o único jeito de aproveitar
 * a melhoria seria desfazer a importação e importar o arquivo de novo, o que
 * significa perder tudo que já foi ajustado à mão naquelas linhas.
 *
 * Só preenche o que está VAZIO. Uma categoria já preenchida pode ter sido
 * escolhida pelo casal, e o banco não guarda quem a escolheu; sobrescrever
 * seria apagar trabalho de alguém para pôr um palpite no lugar.
 *
 * A categoria que o banco mandou no arquivo não é guardada no lançamento, só
 * o estabelecimento. Então a reanálise trabalha com regra aprendida, nome da
 * loja e tipo - as linhas que dependiam exclusivamente da dica do banco
 * continuam sem categoria até o arquivo ser importado de novo.
 */
export async function reclassifyInvoice(
  invoiceId: string,
): Promise<{ error?: string; updated?: number; remaining?: number }> {
  if (!z.string().uuid().safeParse(invoiceId).success) {
    return { error: "Fatura inválida." };
  }

  const houseId = await requireHouseId();
  const supabase = await createClient();

  const { data: rows, error: rowsError } = await supabase
    .from("transactions")
    .select("id, merchant_normalized, type")
    .eq("house_id", houseId)
    .eq("invoice_id", invoiceId)
    .is("category_id", null);

  if (rowsError) {
    console.error("[importacao] falha ao reanalisar", { code: rowsError.code });
    return { error: "Não foi possível reanalisar a fatura." };
  }
  if (!rows || rows.length === 0) {
    return { updated: 0, remaining: 0 };
  }

  const maps = await loadCategoryMaps(supabase, houseId);

  // Agrupa por categoria para gravar em algumas chamadas, e não uma por
  // lançamento: uma fatura tem dezenas de linhas e no máximo uma dúzia de
  // categorias.
  const idsByCategory = new Map<string, string[]>();
  for (const row of rows) {
    const categoryId = resolveCategoryId(
      {
        merchantNormalized: String(row.merchant_normalized ?? ""),
        categoryHint: null,
        type: String(row.type),
      },
      maps,
    );
    if (categoryId === null) continue;
    const list = idsByCategory.get(categoryId) ?? [];
    list.push(row.id as string);
    idsByCategory.set(categoryId, list);
  }

  let updated = 0;
  for (const [categoryId, ids] of idsByCategory) {
    const { error } = await supabase
      .from("transactions")
      .update({ category_id: categoryId })
      // O `is null` continua no update: entre a leitura e a gravação alguém
      // pode ter categorizado a linha à mão, e ela tem prioridade.
      .in("id", ids)
      .is("category_id", null);

    if (error) {
      console.error("[importacao] falha ao gravar reanalise", {
        code: error.code,
      });
      return { error: "Não foi possível gravar a reanálise." };
    }
    updated += ids.length;
  }

  revalidatePath("/inicio");
  revalidatePath("/extratos");

  return { updated, remaining: rows.length - updated };
}

/**
 * Desfaz uma importação (secao 6).
 *
 * Apaga os lançamentos e marca a fatura como revertida em vez de excluí-la:
 * o registro de que a importação aconteceu e foi desfeita faz parte do
 * histórico. O trigger de auditoria registra cada exclusão.
 */
export async function revertImport(
  invoiceId: string,
): Promise<{ error?: string; removed?: number }> {
  const supabase = await createClient();

  const { count, error: deleteError } = await supabase
    .from("transactions")
    .delete({ count: "exact" })
    .eq("invoice_id", invoiceId);

  if (deleteError) {
    console.error("[importacao] falha ao desfazer", { code: deleteError.code });
    return { error: "Não foi possível desfazer a importação." };
  }

  const { error: statusError } = await supabase
    .from("invoices")
    // file_hash zerado para o mesmo arquivo poder ser importado de novo -
    // sem isso a unique parcial bloquearia a segunda tentativa.
    .update({ status: "reverted", file_hash: null })
    .eq("id", invoiceId);

  if (statusError) {
    console.error("[importacao] falha ao marcar revertida", {
      code: statusError.code,
    });
  }

  revalidatePath("/inicio");
  revalidatePath("/extratos");
  revalidatePath("/importar");

  return { removed: count ?? 0 };
}
