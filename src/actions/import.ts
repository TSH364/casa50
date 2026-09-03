"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import { fromMonthKey } from "@/data/mappers";
import { duplicateKey, normalizeMerchant } from "@/importers/detect";
import { isMonthKey } from "@/domain/month";
import { fromCents } from "@/lib/money";
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
  const computed = toImport.reduce(
    // Estorno e pagamento entram no total da fatura com sinal invertido -
    // é assim que o valor bate com o que o banco imprime no rodapé.
    (sum, d) =>
      d.type === "refund" || d.type === "payment"
        ? sum - d.amountCents
        : sum + d.amountCents,
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

  // Regras aprendidas e categorias, para pré-classificar.
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

  const ruleByPattern = new Map<string, string | null>(
    (rules ?? []).map((r) => [
      String(r.normalized_pattern),
      r.category_id as string | null,
    ]),
  );
  const categoryByName = new Map<string, string>(
    (categories ?? []).map((c) => [
      normalizeMerchant(String(c.name)),
      c.id as string,
    ]),
  );

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
      const fromRule = ruleByPattern.get(draft.merchantNormalized);
      const fromHint = draft.categoryHint
        ? categoryByName.get(normalizeMerchant(draft.categoryHint))
        : undefined;
      categoryId = fromRule ?? fromHint ?? null;
      if (categoryId !== null) autoCategorized += 1;
    }

    const existingId = existingByKey.get(key);
    const repeatedInFile = seenInFile.has(key);
    seenInFile.add(key);

    return {
      ...draft,
      invoiceMonth,
      categoryId,
      cardId: rowCardId,
      duplicateKey: key,
      decision: existingId || repeatedInFile ? "duplicate" : "new",
      ...(existingId ? { duplicateOfId: existingId } : {}),
    };
  });

  if (autoCategorized > 0) {
    notes.push(
      `${autoCategorized} lançamento(s) categorizados automaticamente por regra ou pela categoria do arquivo.`,
    );
  }
  const dupes = reviewed.filter((d) => d.decision === "duplicate").length;
  if (dupes > 0) {
    notes.push(
      `${dupes} possível(is) repetição(ões). Confira antes de confirmar — a mesma compra pode aparecer legitimamente duas vezes.`,
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
