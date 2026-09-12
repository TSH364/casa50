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
  matchCategoryNames,
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
/**
 * O que uma regra aprendida manda fazer com um estabelecimento.
 *
 * Passou a carregar a subcategoria quando o app comecou a PROPOR subcategorias
 * por comportamento (secao 14): antes disso a coluna `subcategory_id` existia
 * em `learned_rules` e nao era lida por ninguem, entao a subcategoria decidida
 * numa fatura se perdia na seguinte.
 */
interface RuleTarget {
  categoryId: string | null;
  subcategoryId: string | null;
}

interface CategoryMaps {
  ruleByPattern: Map<string, RuleTarget>;
  byName: Map<string, string>;
  nameById: Map<string, string>;
  /**
   * Nome canônico ("Transporte") -> id da categoria da casa que o atende.
   *
   * Existe porque a casa pode renomear: quem chama de "Carro" o que veio como
   * "Transporte" perdia toda sugestão daquela categoria, em silêncio.
   */
  byCanonical: Map<string, string>;
}

async function loadCategoryMaps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  houseId: string,
): Promise<CategoryMaps> {
  const [{ data: rules }, { data: categories }] = await Promise.all([
    supabase
      .from("learned_rules")
      .select("normalized_pattern, category_id, subcategory_id")
      .eq("house_id", houseId),
    supabase
      .from("categories")
      .select("id, name")
      .eq("house_id", houseId)
      .eq("is_active", true),
  ]);

  const byName = new Map<string, string>(
    (categories ?? []).map((c) => [
      normalizeMerchant(String(c.name)),
      c.id as string,
    ]),
  );

  const byCanonical = new Map<string, string>();
  for (const [canonical, realName] of matchCategoryNames(
    (categories ?? []).map((c) => String(c.name)),
  )) {
    const id = byName.get(normalizeMerchant(realName));
    if (id) byCanonical.set(canonical, id);
  }

  return {
    ruleByPattern: new Map(
      (rules ?? []).map((r) => [
        String(r.normalized_pattern),
        {
          categoryId: r.category_id as string | null,
          subcategoryId: r.subcategory_id as string | null,
        },
      ]),
    ),
    byName,
    nameById: new Map(
      (categories ?? []).map((c) => [c.id as string, String(c.name)]),
    ),
    byCanonical,
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
  /** Nome canônico da tabela -> categoria da casa, mesmo renomeada. */
  const canonical = (name: string | null) =>
    name ? maps.byCanonical.get(name) : undefined;
  /** Nome cru vindo do arquivo, que pode coincidir com o da casa. */
  const literal = (name: string | null) =>
    name ? maps.byName.get(normalizeMerchant(name)) : undefined;

  const fromRule = maps.ruleByPattern.get(input.merchantNormalized)?.categoryId;
  const fromMerchant = canonical(categoryFromMerchant(input.merchantNormalized));
  const fromHint = input.categoryHint
    ? (literal(input.categoryHint) ??
       canonical(categoryFromHint(input.categoryHint)))
    : undefined;
  const fromType = input.type === "fee" ? canonical("Tarifas") : undefined;

  return fromRule ?? fromMerchant ?? fromHint ?? fromType ?? null;
}

/**
 * Subcategoria que a regra aprendida manda, se houver.
 *
 * So vale quando a regra e a linha concordam sobre a categoria-mae. Sem essa
 * checagem, uma linha que caiu em Mercado pelo nome da loja receberia a
 * subcategoria "Rotina de dia util" de Alimentacao, e a subcategoria ficaria
 * pendurada numa arvore a que nao pertence.
 */
function resolveSubcategoryId(
  merchantNormalized: string,
  categoryId: string | null,
  maps: CategoryMaps,
): string | null {
  if (categoryId === null) return null;
  const rule = maps.ruleByPattern.get(merchantNormalized);
  if (!rule || rule.categoryId !== categoryId) return null;
  return rule.subcategoryId;
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
    subcategory_id: resolveSubcategoryId(
      d.merchantNormalized,
      d.categoryId,
      maps,
    ),
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
      "id, merchant_normalized, type, category_hint, category_id, card_id, card_last_four",
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
  const semCategoria = rows.filter((r) => r.category_id === null);
  if (semCategoria.length === 0) {
    revalidatePath("/inicio");
    revalidatePath("/extratos");
    return {
      updated: 0,
      remaining: 0,
      cardsLinked,
      cardsCreated,
      withoutStoredCard,
    };
  }

  const maps = await loadCategoryMaps(supabase, houseId);

  // Agrupa por categoria para gravar em algumas chamadas, e não uma por
  // lançamento: uma fatura tem dezenas de linhas e no máximo uma dúzia de
  // categorias.
  const idsByCategory = new Map<string, string[]>();
  for (const row of semCategoria) {
    const merchant = String(row.merchant_normalized ?? "");
    const categoryId = resolveCategoryId(
      {
        merchantNormalized: merchant,
        categoryHint: (row.category_hint as string | null) ?? null,
        type: String(row.type),
      },
      maps,
    );
    if (categoryId === null) continue;
    // A subcategoria entra na mesma chave de agrupamento: sem isso ela viraria
    // uma segunda gravacao por lancamento, e a reanalise existe justamente
    // para nao ir ao banco linha a linha.
    const subcategoryId = resolveSubcategoryId(merchant, categoryId, maps);
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

  revalidatePath("/inicio");
  revalidatePath("/extratos");

  return {
    updated,
    remaining: semCategoria.length - updated,
    cardsLinked,
    cardsCreated,
    withoutStoredCard,
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
