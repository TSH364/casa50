"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";
import { getAiKey } from "@/lib/ai-config";
import { recordAiUsage } from "@/lib/ai-usage";
import { JEV_MODEL } from "@/domain/ai-models";
import { loadJevContext } from "@/lib/jev-context";
import { runJev } from "@/lib/jev-run";
import { listMembers } from "@/lib/houses";
import { loadCategoryMaps, resolveCategory, resolveSubcategoryId } from "@/lib/category-rules";
import { normalizeMerchant } from "@/importers/detect";
import { firstName } from "@/domain/chat";
import {
  JEV_MIN_DONO,
  JEV_MIN_PROPOSTA,
  OWNER_INSTRUCTIONS,
  buildQuestions,
  cardState,
  ownerCriteria,
  readPick,
  medianCents,
  merchantState,
  readVerdict,
  weekdayShare,
} from "@/domain/jev";
import type { BuiltQuestions, MerchantAsk } from "@/domain/jev";

/**
 * O Jev separando o que ja foi importado (secao 15).
 *
 * MEDIDO antes de escrever: das 417 despesas de Alimentacao, 341 estao sem
 * subcategoria; das 136 de Transporte, 113 - inclusive "UBERRIDES", que e
 * Uber e esta fora de "Uber". E aqui que classificar ajuda; categoria quase
 * tudo ja tem (3 de 1.021 estavam sem).
 *
 * DOIS PASSOS, e o segundo e da casa:
 *
 *   1. `suggestSubcategoriesWithJev` pergunta, por estabelecimento, e devolve
 *      PROPOSTAS. Nao grava nada.
 *   2. `applyJevSubcategories` grava so o que a casa marcou - e, porque foi a
 *      casa que confirmou, guarda a regra aprendida, para a proxima fatura ja
 *      chegar separada. E a mesma regra que `acceptSubcategorySuggestion`
 *      grava; so a origem da proposta e outra.
 */

export interface JevSuggestion {
  merchant: string;
  label: string;
  count: number;
  medianCents: number;
  weekdayShare: number;
  subcategoryId: string;
  subcategoryName: string;
  probability: number;
}

export interface SuggestResult {
  error?: string;
  suggestions?: JevSuggestion[];
  /** Estabelecimentos perguntados. */
  asked?: number;
  /** Frase para a tela quando o Jev parou antes do fim. */
  note?: string;
}

const PAGINA = 1000;
/** Teto por rodada: ~15 s com seis em paralelo, e centavos de milesimo. */
const MAX_LOJAS = 80;

const sugerirSchema = z.object({ categoryId: z.string().uuid() });

export async function suggestSubcategoriesWithJev(
  input: z.input<typeof sugerirSchema>,
): Promise<SuggestResult> {
  const parsed = sugerirSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };
  const { categoryId } = parsed.data;

  // A casa primeiro: acao de servidor e endereco publico, e sem isto
  // qualquer um gastaria os creditos da chave da casa.
  const houseId = await requireHouseId();
  const apiKey = await getAiKey(houseId);
  if (!apiKey) return { error: "Guarde a chave do OpenRouter na tela da Casa para usar o Jev." };

  const supabase = await createClient();
  const ctx = await loadJevContext(supabase, houseId);
  const parent = ctx.parents.find((p) => p.id === categoryId);
  const subs = ctx.subsByParent.get(categoryId);
  if (!parent) return { error: "Categoria não encontrada." };
  if (!subs || subs.length === 0) {
    return { error: `${parent.name} ainda não tem subcategorias para o Jev escolher.` };
  }

  // Os que ainda estao sem subcategoria. Paginado: o PostgREST corta em
  // 1.000 linhas, e Alimentacao sozinha chega perto disso.
  const linhas: { merchant: string; label: string; cents: number; date: string }[] = [];
  for (let pagina = 0; pagina < 10; pagina += 1) {
    const { data, error } = await supabase
      .from("transactions")
      .select("merchant_normalized, merchant_original, description, amount, date")
      .eq("house_id", houseId)
      .eq("category_id", categoryId)
      .eq("type", "expense")
      .is("subcategory_id", null)
      .order("id")
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) {
      console.error("[jev] falha ao ler lancamentos", { code: error.code });
      return { error: "Não foi possível ler os lançamentos." };
    }
    for (const t of data ?? []) {
      const merchant = String(t.merchant_normalized ?? "");
      if (!merchant) continue;
      linhas.push({
        merchant,
        label: String(t.merchant_original || t.description || merchant),
        cents: Math.round(Number(t.amount) * 100),
        date: String(t.date).slice(0, 10),
      });
    }
    if ((data ?? []).length < PAGINA) break;
  }

  const grupos = new Map<string, typeof linhas>();
  for (const l of linhas) {
    const g = grupos.get(l.merchant) ?? [];
    g.push(l);
    grupos.set(l.merchant, g);
  }

  const perguntas = new Map<string, { ask: MerchantAsk; built: BuiltQuestions }>();
  const asks: MerchantAsk[] = [...grupos]
    .map(([merchant, g]) => ({
      merchant,
      knownCategoryId: categoryId,
      evidence: {
        label: g[0]!.label,
        count: g.length,
        medianCents: medianCents(g.map((l) => l.cents)),
        weekdayShare: weekdayShare(g.map((l) => l.date)),
        bankHint: null,
      },
    }))
    .sort((a, b) => b.evidence.count - a.evidence.count);
  for (const ask of asks) {
    const built = buildQuestions(ask, ctx);
    if (built) perguntas.set(ask.merchant, { ask, built });
  }
  if (perguntas.size === 0) return { suggestions: [], asked: 0 };

  const run = await runJev(
    [...perguntas.values()].map(({ ask, built }) => ({
      key: ask.merchant,
      state: merchantState(ask.evidence),
      questions: built.questions,
    })),
    { apiKey, maxJobs: MAX_LOJAS, deadlineMs: 40_000 },
  );
  await recordAiUsage(houseId, "jev", { calls: run.calls, costUsd: run.costUsd, model: JEV_MODEL });

  const suggestions: JevSuggestion[] = [];
  for (const [merchant, { ask, built }] of perguntas) {
    const respostas = run.answers.get(merchant);
    if (!respostas) continue;
    const v = readVerdict(respostas, built, ask, {
      category: 0,
      subcategory: JEV_MIN_PROPOSTA,
    });
    if (v.subcategoryId === null || v.subcategoryProbability === null) continue;
    suggestions.push({
      merchant,
      label: ask.evidence.label,
      count: ask.evidence.count,
      medianCents: ask.evidence.medianCents,
      weekdayShare: ask.evidence.weekdayShare,
      subcategoryId: v.subcategoryId,
      subcategoryName: ctx.nameById.get(v.subcategoryId) ?? "",
      probability: v.subcategoryProbability,
    });
  }

  // O que mais pesa primeiro: muita compra e muita certeza.
  suggestions.sort((a, b) => b.count * b.probability - a.count * a.probability);

  return {
    suggestions,
    asked: run.answers.size,
    ...(run.stoppedBy ? { note: run.stoppedBy } : {}),
  };
}

const aplicarSchema = z.object({
  categoryId: z.string().uuid(),
  items: z
    .array(
      z.object({
        merchant: z.string().trim().min(1).max(300),
        subcategoryId: z.string().uuid(),
      }),
    )
    .min(1, "Marque ao menos um estabelecimento.")
    .max(200),
});

export type ApplyResult = FormState & { count?: number };

export async function applyJevSubcategories(
  input: z.input<typeof aplicarSchema>,
): Promise<ApplyResult> {
  const parsed = aplicarSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { categoryId, items } = parsed.data;

  const [houseId, user, supabase] = await Promise.all([
    requireHouseId(),
    getCurrentUser(),
    createClient(),
  ]);

  // Cada subcategoria tem de ser filha DESTA categoria, nesta casa. O id vem
  // do navegador; sem esta conferencia, um id de outra arvore penduraria o
  // lancamento numa subcategoria a que ele nao pertence.
  const ids = [...new Set(items.map((i) => i.subcategoryId))];
  const { data: validas } = await supabase
    .from("categories")
    .select("id")
    .eq("house_id", houseId)
    .eq("parent_id", categoryId)
    .in("id", ids);
  const permitidas = new Set((validas ?? []).map((c) => c.id as string));
  if (ids.some((id) => !permitidas.has(id))) {
    return { error: "Subcategoria não encontrada nesta categoria." };
  }

  const porSub = new Map<string, string[]>();
  for (const i of items) {
    const lista = porSub.get(i.subcategoryId) ?? [];
    lista.push(i.merchant);
    porSub.set(i.subcategoryId, lista);
  }

  let total = 0;
  for (const [subcategoryId, merchants] of porSub) {
    // So os que ainda estao sem subcategoria: um lancamento que alguem
    // separou a mao nesse meio-tempo e decisao tomada.
    const { data: marcados, error } = await supabase
      .from("transactions")
      .update({ subcategory_id: subcategoryId })
      .eq("house_id", houseId)
      .eq("category_id", categoryId)
      .is("subcategory_id", null)
      .in("merchant_normalized", merchants)
      .select("id");
    if (error) {
      console.error("[jev] falha ao aplicar", { code: error.code });
      return {
        error:
          total > 0
            ? `Parte foi aplicada (${total} lançamentos), mas o resto falhou. Tente de novo.`
            : "Não foi possível aplicar.",
      };
    }
    total += marcados?.length ?? 0;

    const { error: erroRegra } = await supabase.from("learned_rules").upsert(
      merchants.map((pattern) => ({
        house_id: houseId,
        pattern,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        created_by: user?.id ?? null,
      })),
      { onConflict: "house_id,normalized_pattern" },
    );
    if (erroRegra) {
      // Como no aceite de proposta: o passado ja foi separado; so a proxima
      // fatura e que vai precisar da decisao de novo.
      console.error("[jev] falha ao aprender a regra", { code: erroRegra.code });
    }
  }

  revalidatePath("/categorias");
  revalidatePath("/extratos");
  revalidatePath("/insights");
  revalidatePath("/inicio");
  return { ok: true, count: total };
}

// ---------------------------------------------------------------------------
// De quem e o cartao
// ---------------------------------------------------------------------------

export interface OwnerSuggestion {
  error?: string;
  /** `null` quando o Jev nao passou do corte: melhor nao sugerir que chutar. */
  memberId?: string | null;
  probability?: number;
}

const donoSchema = z.object({ cardId: z.string().uuid() });

/**
 * O Jev sugere o dono de um cartao sem dono (secao 15).
 *
 * Para o caso que a sugestao pelos dados nao cobre: cartao em que ninguem
 * marcou lancamento nenhum. A pergunta compara as lojas do cartao com as
 * lojas tipicas de cada pessoa - o que esta marcado com ela e o que esta nos
 * cartoes que ja sao dela.
 *
 * So SUGERE. O dono muda pelo toque em "E de Fulano?", com `setCardOwner`.
 */
export async function suggestCardOwnerWithJev(
  input: z.input<typeof donoSchema>,
): Promise<OwnerSuggestion> {
  const parsed = donoSchema.safeParse(input);
  if (!parsed.success) return { error: "Cartão inválido." };
  const houseId = await requireHouseId();
  const apiKey = await getAiKey(houseId);
  if (!apiKey) return { error: "Guarde a chave do OpenRouter na tela da Casa para usar o Jev." };

  const supabase = await createClient();
  const [membros, { data: cartoes }] = await Promise.all([
    listMembers(houseId),
    supabase.from("cards").select("id, owner_id").eq("house_id", houseId),
  ]);
  if (membros.length < 2) return { error: "Com uma pessoa só na casa, o cartão é dela." };
  const cartao = (cartoes ?? []).find((c) => c.id === parsed.data.cardId);
  if (!cartao) return { error: "Cartão não encontrado." };

  const dono = new Map((cartoes ?? []).map((c) => [c.id as string, (c.owner_id as string | null) ?? null]));

  const noCartao = new Map<string, number>();
  const porPessoa = new Map<string, Map<string, number>>(membros.map((m) => [m.userId, new Map()]));
  for (let pagina = 0; pagina < 10; pagina += 1) {
    const { data, error } = await supabase
      .from("transactions")
      .select("card_id, member_id, merchant_normalized")
      .eq("house_id", houseId)
      .eq("type", "expense")
      .order("id")
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) return { error: "Não foi possível ler os lançamentos." };
    for (const t of data ?? []) {
      const loja = t.merchant_normalized as string | null;
      if (!loja) continue;
      const cardId = t.card_id as string | null;
      if (cardId === parsed.data.cardId) {
        noCartao.set(loja, (noCartao.get(loja) ?? 0) + 1);
        continue;
      }
      // De quem e: marcado, ou o dono do cartao - a mesma regra do filtro.
      const pessoa = (t.member_id as string | null) ?? (cardId ? dono.get(cardId) : null) ?? null;
      const m = pessoa ? porPessoa.get(pessoa) : undefined;
      if (m) m.set(loja, (m.get(loja) ?? 0) + 1);
    }
    if ((data ?? []).length < PAGINA) break;
  }

  if (noCartao.size === 0) return { error: "Este cartão ainda não tem lançamentos para comparar." };
  const semEvidencia = membros.filter((m) => (porPessoa.get(m.userId)?.size ?? 0) === 0);
  if (semEvidencia.length > 0) {
    return {
      error: `Falta referência de ${semEvidencia.map((m) => firstName(m.fullName)).join(" e ")}: marque alguns lançamentos ou o dono de um cartão dela primeiro.`,
    };
  }

  const ordenar = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
  const criteria = ownerCriteria(
    membros.map((m) => ({
      id: m.userId,
      firstName: firstName(m.fullName),
      examples: ordenar(porPessoa.get(m.userId)!).slice(0, 12).map(([loja]) => loja),
    })),
  );

  const run = await runJev(
    [
      {
        key: "dono",
        state: cardState(ordenar(noCartao).map(([label, count]) => ({ label, count }))),
        questions: { dono: { type: "choice", instructions: OWNER_INSTRUCTIONS, criteria: criteria.criteria } },
      },
    ],
    { apiKey, maxJobs: 1, deadlineMs: 15_000 },
  );
  await recordAiUsage(houseId, "jev", { calls: run.calls, costUsd: run.costUsd, model: JEV_MODEL });
  const resposta = run.answers.get("dono")?.dono;
  if (!resposta) return { error: run.stoppedBy ?? "O Jev não respondeu. Tente de novo." };

  const pick = readPick(resposta, criteria.idByKey, JEV_MIN_DONO);
  const probabilidade = resposta.probabilities[resposta.choice] ?? 0;
  return { memberId: pick?.id ?? null, probability: probabilidade };
}

// ---------------------------------------------------------------------------
// Lancamento manual: sugestao pela descricao
// ---------------------------------------------------------------------------

export interface CategorySuggestion {
  categoryId?: string | null;
  subcategoryId?: string | null;
  /** De onde veio: regra da casa, nome de loja conhecido, ou o Jev. */
  via?: "regra" | "loja" | "jev";
  probability?: number;
}

const sugestaoSchema = z.object({
  description: z.string().trim().min(2).max(200),
  amountCents: z.number().int().min(0).max(9_999_999_999).optional(),
});

/**
 * A categoria de um lancamento manual, sugerida pela descricao (secao 15).
 *
 * A mesma ordem da importacao: regra aprendida, loja conhecida, e so entao o
 * Jev. Descricao que a regra resolve nem sai para a rede. Devolve vazio
 * quando ninguem sabe - o campo fica como a pessoa deixou.
 */
export async function suggestCategoryFromText(
  input: z.input<typeof sugestaoSchema>,
): Promise<CategorySuggestion> {
  const parsed = sugestaoSchema.safeParse(input);
  if (!parsed.success) return {};
  const houseId = await requireHouseId();
  const supabase = await createClient();
  const maps = await loadCategoryMaps(supabase, houseId);

  const merchant = normalizeMerchant(parsed.data.description);
  const regra = resolveCategory({ merchantNormalized: merchant, categoryHint: null, type: "expense" }, maps);
  if (regra.id !== null && (regra.source === "regra" || regra.source === "loja")) {
    return {
      categoryId: regra.id,
      subcategoryId: resolveSubcategoryId(merchant, regra.id, maps),
      via: regra.source,
    };
  }

  const apiKey = await getAiKey(houseId);
  if (!apiKey) return {};
  const ctx = await loadJevContext(supabase, houseId);
  const ask = {
    merchant,
    knownCategoryId: null,
    evidence: {
      label: parsed.data.description,
      count: 1,
      medianCents: parsed.data.amountCents ?? 0,
      weekdayShare: 0,
      bankHint: null,
    },
  };
  const built = buildQuestions(ask, ctx);
  if (!built) return {};
  const run = await runJev(
    [{ key: "x", state: merchantState(ask.evidence), questions: built.questions }],
    { apiKey, maxJobs: 1, deadlineMs: 10_000 },
  );
  await recordAiUsage(houseId, "jev", { calls: run.calls, costUsd: run.costUsd, model: JEV_MODEL });
  const respostas = run.answers.get("x");
  if (!respostas) return {};
  const v = readVerdict(respostas, built, ask);
  if (v.categoryId === null) return {};
  return {
    categoryId: v.categoryId,
    subcategoryId: v.subcategoryId,
    via: "jev",
    probability: v.categoryProbability ?? undefined,
  };
}
