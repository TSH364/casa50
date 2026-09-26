"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import { RECURRENCE_COLUMNS, fromMonthKey, mapRecurrence } from "@/data/mappers";
import { duplicateKey } from "@/importers/detect";
import { isMonthKey } from "@/domain/month";
import { fromCents } from "@/lib/money";
import { spendingOfCents } from "@/domain/finance";
import { matchRecurrence } from "@/domain/forecast";
import type {
  DraftTransaction,
  ImportSummary,
  ReviewedDraft,
} from "@/importers/types";
import type { TransactionType } from "@/domain/types";
import { getAiKey } from "@/lib/ai-config";
import {
  loadCategoryMaps,
  resolveCategory,
  resolveCategoryId,
  resolveSubcategoryId,
} from "@/lib/category-rules";
import type { CategoryMaps } from "@/lib/category-rules";
import { loadJevContext } from "@/lib/jev-context";
import { runJev } from "@/lib/jev-run";
import {
  buildQuestions,
  importAsks,
  merchantState,
  readVerdict,
} from "@/domain/jev";
import type { BuiltQuestions, MerchantAsk } from "@/domain/jev";

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
  /**
   * Subcategoria que a revisao propos (hoje, so pelo Jev). Conferida de novo
   * na gravacao: tem de ser filha da categoria da linha, nesta casa.
   */
  subcategoryId: z.string().uuid().nullable().optional(),
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
 * A subcategoria que a revisao propos, se ela ainda faz sentido.
 *
 * Passa pelo navegador, entao e conferida aqui: tem de ser filha da
 * categoria da linha, nesta casa. Uma subcategoria de Alimentacao numa linha
 * que a pessoa deixou em Transporte ficaria pendurada numa arvore a que nao
 * pertence - e um id de outra casa nem esta em `parentById`.
 */
function proposedSubcategoryId(
  d: { subcategoryId?: string | null; categoryId: string | null },
  maps: CategoryMaps,
): string | null {
  if (!d.subcategoryId || d.categoryId === null) return null;
  return maps.parentById.get(d.subcategoryId) === d.categoryId ? d.subcategoryId : null;
}

/**
 * O Jev olha o que as regras nao resolveram (secao 15).
 *
 * So entra onde a decisao atual e fraca - a dica do banco, que "erra muito",
 * ou nada - e na subcategoria de lojas cuja categoria e firme mas que nenhuma
 * regra separa ainda. Regra aprendida e nome de loja conhecido nunca sao
 * trocados por palpite.
 *
 * O palpite entra MARCADO ("Jev · 87%"), e NAO vira regra aprendida: regra e
 * o que a casa disse. Se o casal corrigir a linha depois, no extrato, ai sim
 * nasce a regra - como qualquer correcao.
 *
 * Sem chave de IA, nao faz nada e nao diz nada: o Jev e um extra, e a
 * importacao funcionava antes dele.
 */
/** Uma linha que o Jev pode classificar - da revisao ou de uma fatura ja gravada. */
interface JevRow {
  /** Identifica a linha para quem chamou: numero da linha, ou id do lancamento. */
  key: string;
  merchantNormalized: string;
  merchantOriginal: string;
  description: string;
  amountCents: number;
  date: string;
  categoryHint: string | null;
  /** A categoria que a linha tem agora (regra, loja, dica do banco, ou a mao). */
  categoryId: string | null;
  /** So nestas o Jev pode TROCAR a categoria: dica do banco, ou nenhuma. */
  weak: boolean;
}

interface JevDecision {
  /** Presente so quando a linha era fraca e o Jev passou do corte. */
  categoryId?: string;
  categoryProbability?: number;
  /** Presente so quando e filha da categoria FINAL da linha. */
  subcategoryId?: string;
  subcategoryProbability?: number;
}

/**
 * O Jev olhando o que as regras nao resolveram (secao 15).
 *
 * Um motor so para a importacao e para a releitura de faturas antigas: as
 * duas tem de decidir igual, ou a mesma loja cai em categorias diferentes
 * dependendo da porta por onde entrou.
 *
 * Regra aprendida e loja conhecida nunca sao trocadas: o Jev so decide a
 * categoria de linha fraca, e a subcategoria de loja que nenhuma regra separa.
 * Palpite NAO vira regra aprendida - regra e o que a casa disse.
 *
 * Sem chave, devolve vazio e nao diz nada: o Jev e um extra.
 */
async function jevDecisions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  houseId: string,
  rows: readonly JevRow[],
  maps: CategoryMaps,
): Promise<{ byKey: Map<string, JevDecision>; stoppedBy: string | null; merchants: number }> {
  const vazio = { byKey: new Map<string, JevDecision>(), stoppedBy: null, merchants: 0 };
  if (rows.length === 0) return vazio;
  const apiKey = await getAiKey(houseId);
  if (!apiKey) return vazio;

  const ctx = await loadJevContext(supabase, houseId);
  const asks = importAsks(
    rows.map((r) => ({
      ...r,
      ruleDecidesSubcategory:
        resolveSubcategoryId(r.merchantNormalized, r.categoryId, maps) !== null,
    })),
    ctx.subsByParent,
  );

  const perguntas = new Map<string, { ask: MerchantAsk; built: BuiltQuestions }>();
  for (const ask of asks) {
    const built = buildQuestions(ask, ctx);
    if (built) perguntas.set(ask.merchant, { ask, built });
  }
  if (perguntas.size === 0) return vazio;

  const run = await runJev(
    [...perguntas.values()].map(({ ask, built }) => ({
      key: ask.merchant,
      state: merchantState(ask.evidence),
      questions: built.questions,
    })),
    { apiKey, maxJobs: 60, deadlineMs: 25_000 },
  );

  const byKey = new Map<string, JevDecision>();
  const lojas = new Set<string>();
  for (const r of rows) {
    const p = perguntas.get(r.merchantNormalized);
    const respostas = run.answers.get(r.merchantNormalized);
    if (!p || !respostas) continue;
    const v = readVerdict(respostas, p.built, p.ask);

    const d: JevDecision = {};
    if (v.categoryId !== null && r.weak) {
      d.categoryId = v.categoryId;
      d.categoryProbability = v.categoryProbability ?? undefined;
    }
    // A subcategoria so vale sob a categoria que a linha vai TER - a mesma
    // conferencia que a gravacao repete.
    const categoriaFinal = d.categoryId ?? r.categoryId;
    if (v.subcategoryId !== null && maps.parentById.get(v.subcategoryId) === categoriaFinal) {
      d.subcategoryId = v.subcategoryId;
      d.subcategoryProbability = v.subcategoryProbability ?? undefined;
    }
    if (d.categoryId || d.subcategoryId) {
      byKey.set(r.key, d);
      lojas.add(r.merchantNormalized);
    }
  }
  return { byKey, stoppedBy: run.stoppedBy, merchants: lojas.size };
}

/** O Jev na revisao da importacao: marca o palpite em cada linha. */
async function classifyWithJev(
  supabase: Awaited<ReturnType<typeof createClient>>,
  houseId: string,
  reviewed: ReviewedDraft[],
  fonteFraca: ReadonlySet<number>,
  maps: CategoryMaps,
): Promise<{ note: string | null }> {
  const candidatas = reviewed.filter(
    (d) => d.decision === "new" && d.type === "expense",
  );
  const r = await jevDecisions(
    supabase,
    houseId,
    candidatas.map((d) => ({ ...d, key: String(d.row), weak: fonteFraca.has(d.row) })),
    maps,
  );

  let linhas = 0;
  for (const d of candidatas) {
    const dec = r.byKey.get(String(d.row));
    if (!dec) continue;
    if (dec.categoryId) {
      d.categoryId = dec.categoryId;
      d.categoryName = maps.nameById.get(dec.categoryId) ?? null;
      d.categoryVia = "jev";
      d.jevProbability = dec.categoryProbability;
    }
    if (dec.subcategoryId) {
      d.subcategoryId = dec.subcategoryId;
      d.subcategoryName = maps.nameById.get(dec.subcategoryId) ?? null;
      d.subcategoryProbability = dec.subcategoryProbability;
    }
    linhas += 1;
  }

  const partes: string[] = [];
  if (linhas > 0) {
    partes.push(
      `O Jev classificou ${linhas} lançamento(s) de ${r.merchants} estabelecimento(s) que as regras não resolviam. Estão marcados com "Jev" e a certeza dele — confira.`,
    );
  }
  if (r.stoppedBy) partes.push(r.stoppedBy);
  return { note: partes.length > 0 ? partes.join(" ") : null };
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
      "id, date, merchant_normalized, amount, type, card_id, installment_current, installment_total",
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
      type: row.type as TransactionType,
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
  const fonteFraca = new Set<number>();

  const reviewed: ReviewedDraft[] = drafts.map((draft) => {
    // O cartão da linha vence o cartão escolhido para o arquivo todo: uma
    // fatura do Itaú traz titular e adicionais no mesmo CSV.
    const rowCardId = draft.cardId ?? cardId;
    const key = duplicateKey({
      invoiceMonth,
      date: draft.date,
      merchantNormalized: draft.merchantNormalized,
      amountCents: draft.amountCents,
      type: draft.type,
      cardId: rowCardId,
      installmentCurrent: draft.installmentCurrent,
      installmentTotal: draft.installmentTotal,
    });

    let categoryId = draft.categoryId;
    if (categoryId === null) {
      const resolvida = resolveCategory(draft, maps);
      categoryId = resolvida.id;
      if (categoryId !== null) autoCategorized += 1;
      // Guardado para o Jev: so onde a fonte e fraca ele pode trocar.
      if (resolvida.source === null || resolvida.source === "banco") {
        fonteFraca.add(draft.row);
      }
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

  const jev = await classifyWithJev(supabase, houseId, reviewed, fonteFraca, maps);
  if (jev.note) notes.push(jev.note);

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

/**
 * Garante um cartão para cada final que veio no arquivo.
 *
 * O extrato sempre informa os 4 últimos dígitos, então exigir que o casal
 * cadastre o cartão antes de importar é pedir um dado que o próprio arquivo
 * já traz. Sem isto, uma fatura com titular e adicionais entrava inteira como
 * "sem cartão" e a visão por cartão ficava vazia.
 *
 * Acontece na GRAVAÇÃO, e não na revisão, de propósito: a tela promete que
 * nada é escrito antes de confirmar, e criar cartão é escrita.
 *
 * O nome é provisório ("Cartão 2150"); `/cartoes` deixa renomear, e o vínculo
 * é pelo id, então renomear depois não desfaz nada.
 */
async function ensureCardsForLastFours(
  supabase: Awaited<ReturnType<typeof createClient>>,
  houseId: string,
  lastFours: readonly string[],
): Promise<{
  error?: string;
  byLastFour: Map<string, string>;
  /** Só os que ESTA chamada criou - é o que o rollback pode desfazer. */
  createdIds: string[];
}> {
  const byLastFour = new Map<string, string>();
  if (lastFours.length === 0) return { byLastFour, createdIds: [] };

  const { data: existing, error: readError } = await supabase
    .from("cards")
    .select("id, last_four")
    .eq("house_id", houseId)
    .in("last_four", [...lastFours]);

  if (readError) {
    console.error("[importacao] falha ao ler cartoes", { code: readError.code });
    return { error: "Não foi possível verificar os cartões.", byLastFour, createdIds: [] };
  }

  for (const row of existing ?? []) {
    const lastFour = row.last_four as string | null;
    if (lastFour && !byLastFour.has(lastFour)) {
      byLastFour.set(lastFour, row.id as string);
    }
  }

  const missing = lastFours.filter((f) => !byLastFour.has(f));
  if (missing.length === 0) return { byLastFour, createdIds: [] };

  const { data: inserted, error: insertError } = await supabase
    .from("cards")
    .insert(
      missing.map((lastFour) => ({
        house_id: houseId,
        name: `Cartão ${lastFour}`,
        last_four: lastFour,
      })),
    )
    .select("id, last_four");

  if (insertError || !inserted) {
    console.error("[importacao] falha ao criar cartoes", {
      code: insertError?.code,
    });
    return { error: "Não foi possível criar os cartões da fatura.", byLastFour, createdIds: [] };
  }

  const createdIds: string[] = [];
  for (const row of inserted) {
    const lastFour = row.last_four as string | null;
    if (lastFour) byLastFour.set(lastFour, row.id as string);
    createdIds.push(row.id as string);
  }

  return { byLastFour, createdIds };
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

  // Antes da fatura: se falhar, nada foi criado ainda e não sobra lixo.
  const finais = [
    ...new Set(
      toImport
        .filter((d) => d.cardId === null)
        .map((d) => d.cardLastFour)
        .filter((f): f is string => f !== null),
    ),
  ];
  const cards = await ensureCardsForLastFours(supabase, houseId, finais);
  if (cards.error) return { error: cards.error };

  const cardIdFor = (d: { cardId: string | null; cardLastFour: string | null }) =>
    d.cardId ??
    (d.cardLastFour ? (cards.byLastFour.get(d.cardLastFour) ?? null) : null) ??
    data.cardId;

  // A fatura aponta para um cartão só; com vários no arquivo ela fica sem, e
  // cada lançamento leva o seu.
  const invoiceCardId =
    data.cardId ?? (cards.byLastFour.size === 1
      ? ([...cards.byLastFour.values()][0] ?? null)
      : null);

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      house_id: houseId,
      card_id: invoiceCardId,
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

  // As regras de novo, aqui: a revisao decidiu a CATEGORIA e o cliente devolveu
  // essa escolha, mas a subcategoria nunca passa pelo navegador - sai da regra
  // no servidor, no momento de gravar. Uma linha a mais no round-trip seria
  // uma linha a mais que o cliente poderia forjar.
  const maps = await loadCategoryMaps(supabase, houseId);

  // As recorrências ativas da casa, para o lançamento já nascer ligado à conta
  // que ele paga. Sem isto o `recurring_id` fica nulo para sempre e o app
  // precisa adivinhar depois o que o cadastro já sabia - ver `matchRecurrence`.
  //
  // A leitura falhar não pode derrubar a importação: o vínculo é um extra, e
  // lançamento gravado sem ele continua correto em tudo o mais.
  const { data: recorrenciasRow, error: recorrenciasError } = await supabase
    .from("recurrences")
    .select(RECURRENCE_COLUMNS)
    .eq("house_id", houseId)
    .eq("is_active", true);

  if (recorrenciasError) {
    console.error("[importacao] falha ao ler recorrencias", {
      code: recorrenciasError.code,
    });
  }
  const recorrencias = (recorrenciasRow ?? []).map(mapRecurrence);

  // Uma recorrência mensal é cobrada UMA vez no mês: se duas linhas do arquivo
  // casarem com a mesma, nenhuma das duas é obviamente a certa, e ligar a
  // primeira seria escolher no escuro. As duas ficam sem vínculo.
  const porRecorrencia = new Map<string, string[]>();
  for (const d of toImport) {
    const r = matchRecurrence(recorrencias, d);
    if (!r) continue;
    const lista = porRecorrencia.get(r.id) ?? [];
    lista.push(d.duplicateKey);
    porRecorrencia.set(r.id, lista);
  }
  const vinculoPorLinha = new Map<string, string>();
  for (const [recurrenceId, chaves] of porRecorrencia) {
    if (chaves.length === 1) vinculoPorLinha.set(chaves[0]!, recurrenceId);
  }

  const rows = toImport.map((d) => ({
    house_id: houseId,
    invoice_id: invoice.id,
    card_id: cardIdFor(d),
    member_id: data.memberId,
    date: d.date,
    invoice_month: fromMonthKey(data.invoiceMonth),
    description: d.description,
    merchant_original: d.merchantOriginal,
    // Guardados crus, como vieram no arquivo: é o que deixa a reanálise
    // alcançar a linha depois, sem precisar do arquivo de novo.
    category_hint: d.categoryHint,
    card_last_four: d.cardLastFour,
    amount: fromCents(d.amountCents),
    type: d.type,
    origin: "invoice" as const,
    status: "confirmed" as const,
    category_id: d.categoryId,
    subcategory_id:
      resolveSubcategoryId(d.merchantNormalized, d.categoryId, maps) ??
      proposedSubcategoryId(d, maps),
    visibility: "shared" as const,
    installment_current: d.installmentCurrent,
    installment_total: d.installmentTotal,
    installment_value:
      d.installmentTotal === null ? null : fromCents(d.amountCents),
    recurring_id: vinculoPorLinha.get(d.duplicateKey) ?? null,
    created_by: user?.id ?? null,
  }));

  const { error: rowsError } = await supabase.from("transactions").insert(rows);

  if (rowsError) {
    console.error("[importacao] falha ao gravar lancamentos", {
      code: rowsError.code,
    });
    // Sem os lançamentos a fatura não representa nada: desfaz para não
    // deixar um registro de importação vazio no histórico. Os cartões criados
    // agora há pouco vão junto - "nada foi importado" precisa ser verdade.
    await supabase.from("invoices").delete().eq("id", invoice.id);
    // Só os criados nesta importação: `byLastFour` também traz cartões que já
    // existiam, e apagar um deles seria destruir cadastro do casal.
    if (cards.createdIds.length > 0) {
      await supabase
        .from("cards")
        .delete()
        .eq("house_id", houseId)
        .in("id", cards.createdIds);
    }
    return { error: "Não foi possível gravar os lançamentos. Nada foi importado." };
  }

  revalidatePath("/inicio");
  revalidatePath("/extratos");
  revalidatePath("/importar");

  return { invoiceId: invoice.id, summary };
}

/**
 * Reanalisa uma fatura já importada, sem apagar nada: preenche categoria e
 * liga cartão, nos lançamentos onde esses campos estão vazios.
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
 * Usa exatamente a mesma decisão da importação, `resolveCategoryId`: regra
 * aprendida, nome da loja, categoria que o banco mandou e tipo. O cartão sai
 * do final guardado no lançamento, criando o cartão se ainda não existir -
 * mesma função que a importação usa.
 *
 * As duas coisas dependem de dado que o arquivo trouxe e que passou a ser
 * guardado nas migrações `20260910000001` (categoria) e `20260910000002`
 * (final do cartão). Lançamentos gravados ANTES delas não têm esses campos, e
 * para eles a reanálise faz o que pode: a categoria ainda sai do nome da loja
 * e do tipo, mas o cartão não tem de onde sair - só reimportando o arquivo.
 */
export interface ReclassifyResult {
  error?: string;
  /** Lançamentos que ganharam categoria. */
  updated?: number;
  /** Continuam sem categoria. */
  remaining?: number;
  /** Lançamentos que ganharam cartão. */
  cardsLinked?: number;
  /** Cartões que precisaram ser criados para isso. */
  cardsCreated?: number;
  /** Sem categoria E sem o final guardado - só reimportando. */
  withoutStoredCard?: number;
  /** Lançamentos que ganharam subcategoria (já tinham categoria). */
  subcategorized?: number;
  /** Quantos dos preenchidos vieram do Jev, e não de regra. */
  byJev?: number;
  /** O Jev parou antes do fim (cota, chave, tempo). */
  note?: string;
}

export async function reclassifyInvoice(
  invoiceId: string,
): Promise<ReclassifyResult> {
  if (!z.string().uuid().safeParse(invoiceId).success) {
    return { error: "Fatura inválida." };
  }

  const houseId = await requireHouseId();
  const supabase = await createClient();

  // Duas perguntas independentes: falta categoria, falta cartão. Uma linha
  // pode precisar de uma, da outra ou das duas, então a leitura pega tudo da
  // fatura e cada passo filtra o que lhe cabe.
  const { data: rows, error: rowsError } = await supabase
    .from("transactions")
    .select(
      "id, merchant_normalized, merchant_original, description, amount, date, type, category_hint, category_id, subcategory_id, card_id, card_last_four",
    )
    .eq("house_id", houseId)
    .eq("invoice_id", invoiceId);

  if (rowsError) {
    console.error("[importacao] falha ao reanalisar", { code: rowsError.code });
    return { error: "Não foi possível reanalisar a fatura." };
  }
  if (!rows || rows.length === 0) {
    return { updated: 0, remaining: 0, cardsLinked: 0, cardsCreated: 0 };
  }

  // ------------------------------------------------------------- cartões
  //
  // Mesma regra da categoria: só preenche o que está VAZIO. Um cartão já
  // escolhido pode ter sido corrigido à mão, e sobrescrever seria apagar
  // trabalho de alguém.
  const semCartao = rows.filter(
    (r) => r.card_id === null && r.card_last_four !== null,
  );
  const finais = [
    ...new Set(semCartao.map((r) => String(r.card_last_four))),
  ];

  let cardsLinked = 0;
  let cardsCreated = 0;
  if (finais.length > 0) {
    const cards = await ensureCardsForLastFours(supabase, houseId, finais);
    if (cards.error) return { error: cards.error };
    cardsCreated = cards.createdIds.length;

    for (const [lastFour, cardId] of cards.byLastFour) {
      const ids = semCartao
        .filter((r) => String(r.card_last_four) === lastFour)
        .map((r) => r.id as string);
      if (ids.length === 0) continue;

      const { error } = await supabase
        .from("transactions")
        .update({ card_id: cardId })
        .in("id", ids)
        .is("card_id", null);

      if (error) {
        console.error("[importacao] falha ao ligar cartao", {
          code: error.code,
        });
        return { error: "Não foi possível ligar os cartões." };
      }
      cardsLinked += ids.length;
    }
  }

  const withoutStoredCard = rows.filter(
    (r) => r.card_id === null && r.card_last_four === null,
  ).length;

  // ---------------------------------------------------------- categorias
  //
  // Duas perguntas, as duas so onde esta VAZIO: falta categoria, ou tem
  // categoria e falta subcategoria. A ordem de quem decide e a da
  // importacao - regra aprendida, loja conhecida, e so entao o Jev -, pelo
  // mesmo motor (`jevDecisions`), para a loja nao cair num lugar na
  // importacao e em outro na releitura.
  const maps = await loadCategoryMaps(supabase, houseId);
  const semCategoria = rows.filter((r) => r.category_id === null);
  const semSub = rows.filter(
    (r) => r.category_id !== null && r.subcategory_id === null && r.type === "expense",
  );

  const regra = new Map(
    semCategoria.map((r) => [
      r.id as string,
      resolveCategory(
        {
          merchantNormalized: String(r.merchant_normalized ?? ""),
          categoryHint: (r.category_hint as string | null) ?? null,
          type: String(r.type),
        },
        maps,
      ),
    ]),
  );

  const paraJev: JevRow[] = [...semCategoria, ...semSub]
    .filter((r) => r.type === "expense" && r.merchant_normalized)
    .map((r) => {
      const resolvida = regra.get(r.id as string);
      return {
        key: r.id as string,
        merchantNormalized: String(r.merchant_normalized),
        merchantOriginal: String(r.merchant_original ?? ""),
        description: String(r.description ?? ""),
        amountCents: Math.round(Number(r.amount) * 100),
        date: String(r.date).slice(0, 10),
        categoryHint: (r.category_hint as string | null) ?? null,
        categoryId: resolvida ? resolvida.id : (r.category_id as string),
        weak: resolvida !== undefined && (resolvida.source === null || resolvida.source === "banco"),
      };
    });
  const jev = await jevDecisions(supabase, houseId, paraJev, maps);
  let byJev = 0;

  // Agrupa por categoria para gravar em algumas chamadas, e não uma por
  // lançamento: uma fatura tem dezenas de linhas e no máximo uma dúzia de
  // categorias.
  const idsByCategory = new Map<string, string[]>();
  for (const row of semCategoria) {
    const merchant = String(row.merchant_normalized ?? "");
    const dec = jev.byKey.get(row.id as string);
    const categoryId = dec?.categoryId ?? regra.get(row.id as string)?.id ?? null;
    if (categoryId === null) continue;
    const subcategoryId =
      resolveSubcategoryId(merchant, categoryId, maps) ?? dec?.subcategoryId ?? null;
    if (dec?.categoryId || (dec?.subcategoryId && subcategoryId === dec.subcategoryId)) byJev += 1;
    const key = `${categoryId}|${subcategoryId ?? ""}`;
    const list = idsByCategory.get(key) ?? [];
    list.push(row.id as string);
    idsByCategory.set(key, list);
  }

  let updated = 0;
  for (const [key, ids] of idsByCategory) {
    const [categoryId, sub] = key.split("|");
    const { error } = await supabase
      .from("transactions")
      .update({ category_id: categoryId, subcategory_id: sub || null })
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

  // ------------------------------------------------------- subcategorias
  const idsBySub = new Map<string, string[]>();
  for (const row of semSub) {
    const categoryId = row.category_id as string;
    const merchant = String(row.merchant_normalized ?? "");
    const dec = jev.byKey.get(row.id as string);
    const subcategoryId =
      resolveSubcategoryId(merchant, categoryId, maps) ?? dec?.subcategoryId ?? null;
    if (subcategoryId === null) continue;
    if (dec?.subcategoryId === subcategoryId) byJev += 1;
    const key = `${categoryId}|${subcategoryId}`;
    const list = idsBySub.get(key) ?? [];
    list.push(row.id as string);
    idsBySub.set(key, list);
  }

  let subcategorized = 0;
  for (const [key, ids] of idsBySub) {
    const [categoryId, subcategoryId] = key.split("|");
    const { error } = await supabase
      .from("transactions")
      .update({ subcategory_id: subcategoryId })
      .in("id", ids)
      // A categoria tem de ser ainda a mesma: se alguem trocou a mao nesse
      // meio-tempo, a subcategoria de outra arvore nao entra.
      .eq("category_id", categoryId)
      .is("subcategory_id", null);
    if (error) {
      console.error("[importacao] falha ao gravar subcategorias", { code: error.code });
      return { error: "Não foi possível gravar a reanálise." };
    }
    subcategorized += ids.length;
  }

  revalidatePath("/inicio");
  revalidatePath("/extratos");

  return {
    updated,
    remaining: semCategoria.length - updated,
    cardsLinked,
    cardsCreated,
    withoutStoredCard,
    subcategorized,
    byJev,
    ...(jev.stoppedBy ? { note: jev.stoppedBy } : {}),
  };
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
