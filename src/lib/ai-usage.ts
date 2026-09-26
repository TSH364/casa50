import "server-only";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * O registro do gasto de IA (secao 15): uma linha por operacao que chamou o
 * OpenRouter, em `ai_usage`, com o custo que ele devolveu.
 *
 * NUNCA derruba quem chamou. O gasto ja aconteceu quando isto roda; falhar em
 * anotar nao pode desfazer uma leitura de orcamento ou uma resposta da
 * conversa. A falha vai para o log e a tela fica com um numero a menos.
 */

export type AiFeature = "orcamento" | "jev" | "conversa_gratuita" | "conversa_paga";

export async function recordAiUsage(
  houseId: string,
  feature: AiFeature,
  usage: { calls: number; costUsd: number; model?: string | null },
): Promise<void> {
  if (usage.calls <= 0) return;
  try {
    const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
    if (!user) return;
    const { error } = await supabase.from("ai_usage").insert({
      house_id: houseId,
      feature,
      model: usage.model ?? null,
      calls: usage.calls,
      // Seis casas, como a coluna: uma chamada do Jev custa ~US$ 0,00002.
      cost_usd: Math.round(Math.max(0, usage.costUsd) * 1e6) / 1e6,
      created_by: user.id,
    });
    if (error) console.error("[ia] falha ao registrar o gasto", { code: error.code });
  } catch {
    console.error("[ia] falha ao registrar o gasto");
  }
}
