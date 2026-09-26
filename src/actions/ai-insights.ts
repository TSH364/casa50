"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { listMembers } from "@/lib/houses";
import { houseView, SHOW_ALL } from "@/lib/house-view";
import { getAiKey } from "@/lib/ai-config";
import { recordAiUsage } from "@/lib/ai-usage";
import { chatCompletion, OpenRouterError } from "@/lib/openrouter";
import { listBudgets, listRecurrences, listTransactions } from "@/data/queries";
import type { SavedAiAnalysis } from "@/data/queries";
import { ANALYSIS_INSTRUCTIONS, buildFacts, checkAnalyses, factsPrompt } from "@/domain/ai-insights";
import { buildInsights } from "@/domain/insights";
import { reconcileRecurrences } from "@/domain/forecast";
import { firstName } from "@/domain/chat";
import { addMonths, currentMonth, isMonthKey } from "@/domain/month";
import { DEFAULT_CHAT_PAID_MODEL } from "@/domain/ai-models";
import { requireHouseId } from "./shared";

/**
 * "Analisar com IA", na tela de Analise (secao 14).
 *
 * Uma chamada, ao modelo PAGO e com provedor que nao guarda os dados: o que
 * sai daqui e o retrato financeiro do mes da casa - totais, categorias, lojas
 * e primeiros nomes. Nada de e-mail, cartao ou id. O modelo gratuito treina
 * com o que recebe, e para este retrato a casa nao escolheu isso.
 *
 * O resultado fica guardado por mes e recorte: quem abrir a tela depois ve a
 * mesma leitura sem pagar outra chamada.
 */

const entrada = z.object({
  month: z.string().refine(isMonthKey, "Mês inválido."),
  scope: z.enum(["casa", "tudo"]),
});

export async function analyzeMonth(input: {
  month: string;
  scope: "casa" | "tudo";
}): Promise<{ error?: string; analysis?: SavedAiAnalysis }> {
  const parsed = entrada.safeParse(input);
  if (!parsed.success) return { error: "Mês inválido." };
  const { month, scope } = parsed.data;

  const houseId = await requireHouseId();
  const apiKey = await getAiKey(houseId);
  if (!apiKey) {
    return { error: "A IA não está disponível para você nesta casa. Quem administra configura a chave em Casa." };
  }

  const view = await houseView(houseId, scope === "tudo" ? SHOW_ALL : undefined);
  const [transactions, budgets, recurrences, members] = await Promise.all([
    // Seis meses de base, e tres para frente: as parcelas ja assumidas.
    listTransactions(houseId, {
      fromMonth: addMonths(month, -6),
      toMonth: addMonths(month, 3),
      excludeCategoryIds: view.excludeCategoryIds,
      limit: 5000,
    }),
    listBudgets(houseId, month),
    listRecurrences(houseId),
    listMembers(houseId),
  ]);

  const ateOMes = transactions.filter((t) => t.invoiceMonth <= month);
  if (!ateOMes.some((t) => t.invoiceMonth === month)) {
    return { error: "Ainda não há lançamentos neste mês para analisar." };
  }
  const recurrenceMatches = reconcileRecurrences(recurrences, ateOMes, month);
  const facts = buildFacts({
    month,
    transactions,
    categories: view.categories,
    budgets,
    recurrenceMatches,
    members: members.map((m) => ({ id: m.userId, name: firstName(m.fullName) })),
    insights: buildInsights({ month, transactions: ateOMes, categories: view.categories, budgets, recurrenceMatches }),
    now: month === currentMonth() ? new Date() : undefined,
  });

  let resposta: string;
  let custo = 0;
  let modelo: string | null = DEFAULT_CHAT_PAID_MODEL;
  try {
    resposta = await chatCompletion(
      [
        { role: "system", content: ANALYSIS_INSTRUCTIONS },
        { role: "user", content: factsPrompt(month, facts) },
      ],
      {
        apiKey,
        model: DEFAULT_CHAT_PAID_MODEL,
        maxTokens: 1500,
        timeoutMessage: "A análise demorou demais. Tente de novo.",
        onUsage: (u) => {
          custo = u.costUsd;
          modelo = u.model;
        },
      },
    );
  } catch (e) {
    await recordAiUsage(houseId, "insights", { calls: 1, costUsd: custo, model: modelo });
    return { error: e instanceof OpenRouterError ? e.message : "A análise com IA falhou." };
  }
  await recordAiUsage(houseId, "insights", { calls: 1, costUsd: custo, model: modelo });

  const checked = checkAnalyses(resposta, facts);
  if (!checked || checked.items.length === 0) {
    return {
      error:
        "A IA não devolveu nenhuma análise que batesse com os números do app, então nada foi mostrado. Tente de novo.",
    };
  }

  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  const { data, error } = await supabase
    .from("ai_insights")
    .insert({ house_id: houseId, month, scope, content: checked, model: modelo, created_by: user?.id ?? null })
    .select("created_at")
    .single();
  if (error) {
    // A analise saiu e foi paga: mostra mesmo sem conseguir guardar.
    console.error("[ia] falha ao guardar a análise", { code: error.code });
  }
  revalidatePath("/analise");
  return {
    analysis: {
      ...checked,
      model: modelo,
      createdAt: data ? String(data.created_at) : new Date().toISOString(),
    },
  };
}
