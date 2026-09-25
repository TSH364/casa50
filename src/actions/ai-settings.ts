"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkKey, OpenRouterError, type KeyInfo } from "@/lib/openrouter";
import { getAiKey } from "@/lib/ai-config";
import { isQuoteModel, OPENROUTER_KEY_RE } from "@/domain/ai-models";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";

/**
 * A configuracao da IA da casa (tela da Casa).
 *
 * A CHAVE ENTRA E NAO VOLTA. Nenhuma acao aqui devolve a chave ao navegador -
 * nem depois de salvar, nem para "mostrar a atual". A tela sabe so os quatro
 * ultimos caracteres. Quem precisar da chave inteira pega no OpenRouter, que e
 * de onde ela veio.
 *
 * Quem pode: dono e administrador. A trava de verdade esta no banco
 * (`set_ai_key` confere o papel); aqui so se traduz a recusa.
 */

function servidorManda(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function traduzir(code: string | undefined, padrao: string): string {
  if (code === "42501") return "Só dono ou administrador da casa muda a configuração de IA.";
  if (code === "22023") return "Isto não parece uma chave do OpenRouter (começa com sk-or-).";
  return padrao;
}

export interface SaveKeyResult extends FormState {
  hint?: string;
  info?: KeyInfo;
  /** Salvou, mas algo merece atenção — ex.: não deu para testar agora. */
  warning?: string;
}

export async function saveAiKey(input: { key: string }): Promise<SaveKeyResult> {
  const parsed = z
    .object({ key: z.string().trim().regex(OPENROUTER_KEY_RE) })
    .safeParse(input);
  if (!parsed.success) {
    return { error: "Isto não parece uma chave do OpenRouter (começa com sk-or-)." };
  }

  const houseId = await requireHouseId();

  if (servidorManda()) {
    // A chave da Vercel vence a da casa (ver `lib/ai-config`). Guardar uma
    // aqui daria a impressao de que ela passou a valer, e nao passou.
    return { error: "A chave está definida no servidor (Vercel), e é ela que vale. Troque lá." };
  }

  // TESTA ANTES DE GUARDAR. Chave recusada nao entra: guardar, criptografada
  // e com capricho, uma chave que o OpenRouter nao aceita so adiaria o erro
  // para a hora de ler um orcamento na loja.
  let info: KeyInfo | undefined;
  let warning: string | undefined;
  try {
    info = await checkKey(parsed.data.key);
  } catch (e) {
    if (e instanceof OpenRouterError && e.status === 401) return { error: e.message };
    // Rede fora do ar, OpenRouter instavel: nao e motivo para recusar uma
    // chave que pode estar boa. Guarda, e diz que nao testou.
    warning = "Não consegui testar a chave agora. Guardei mesmo assim; confira lendo um orçamento.";
  }

  const supabase = await createClient();
  const { data: hint, error } = await supabase.rpc("set_ai_key", {
    p_house: houseId,
    p_key: parsed.data.key,
  });
  if (error) {
    console.error("[ia] falha ao guardar a chave", { code: error.code });
    return { error: traduzir(error.code, "Não foi possível guardar a chave.") };
  }

  revalidatePath("/casa");
  revalidatePath("/projetos");
  return { ok: true, hint: hint as string, info, warning };
}

export async function removeAiKey(): Promise<FormState> {
  const houseId = await requireHouseId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_ai_key", { p_house: houseId });
  if (error) {
    console.error("[ia] falha ao apagar a chave", { code: error.code });
    return { error: traduzir(error.code, "Não foi possível apagar a chave.") };
  }
  revalidatePath("/casa");
  revalidatePath("/projetos");
  return { ok: true };
}

export async function saveQuoteModel(input: { model: string }): Promise<FormState> {
  if (!isQuoteModel(input?.model)) return { error: "Modelo não reconhecido." };
  const houseId = await requireHouseId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ai_quote_model", {
    p_house: houseId,
    p_model: input.model,
  });
  if (error) {
    console.error("[ia] falha ao guardar o modelo", { code: error.code });
    return { error: traduzir(error.code, "Não foi possível guardar o modelo.") };
  }
  revalidatePath("/casa");
  return { ok: true };
}

/**
 * Quanto a chave ja gastou, e o limite dela.
 *
 * Pedido pela tela ao abrir, e nao no carregamento da pagina: a pagina da
 * Casa nao deve esperar o OpenRouter responder para aparecer, nem quebrar se
 * ele estiver fora do ar.
 */
export async function aiKeyUsage(): Promise<{ info?: KeyInfo; error?: string }> {
  const houseId = await requireHouseId();
  const apiKey = await getAiKey(houseId);
  if (!apiKey) return {};
  try {
    return { info: await checkKey(apiKey) };
  } catch (e) {
    return { error: e instanceof OpenRouterError ? e.message : "Não consegui consultar o gasto." };
  }
}
