"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";
import { getAiKey } from "@/lib/ai-config";
import { loadJevContext } from "@/lib/jev-context";
import { runJev } from "@/lib/jev-run";
import {
  JEV_MIN_PROPOSTA,
  buildQuestions,
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
