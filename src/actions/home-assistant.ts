"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hashDoCodigo, novoCodigoHA } from "@/lib/ha-codigo";
import { calcularResumoHA } from "@/data/home-assistant";
import { tabelaAusente } from "@/data/radar";
import { requireHouseId } from "./shared";

/**
 * O Home Assistant pela tela da Casa: gerar (ou trocar) o codigo, desligar,
 * a tarifa de energia, e o resumo que o app grava para ele ler.
 */

/** Resumo mais novo que isto nao e refeito a cada tela aberta. */
const MINUTOS_ENTRE_RESUMOS = 5;

/** Liga, ou troca o codigo. O codigo volta UMA vez: o banco so guarda o hash. */
export async function gerarCodigoHA(): Promise<{ codigo?: string; error?: string }> {
  const [houseId, supabase] = await Promise.all([requireHouseId(), createClient()]);
  const codigo = novoCodigoHA();
  const { error } = await supabase.rpc("ha_ativar", { p_house: houseId, p_hash: hashDoCodigo(codigo) });
  if (error) {
    if (tabelaAusente(error.code)) return { error: "Falta aplicar a atualização do banco do Home Assistant." };
    console.error("[home-assistant] falha ao ligar", { code: error.code });
    return { error: error.code === "42501" ? "Só quem participa da casa liga o Home Assistant." : "Não foi possível gerar o código." };
  }
  // O Home Assistant ja encontra dados na primeira leitura.
  await gravarResumo(supabase, houseId);
  revalidatePath("/casa");
  return { codigo };
}

export async function desligarHA(): Promise<{ error?: string }> {
  const [houseId, supabase] = await Promise.all([requireHouseId(), createClient()]);
  const { error } = await supabase.rpc("ha_desligar", { p_house: houseId });
  if (error) {
    console.error("[home-assistant] falha ao desligar", { code: error.code });
    return { error: "Não foi possível desligar o Home Assistant." };
  }
  revalidatePath("/casa");
  return {};
}

const tarifaSchema = z.number().positive().lt(100).nullable();

/** R$ por kWh, com impostos e bandeira - o que a conta de luz dividida pelo consumo dá. */
export async function salvarTarifaHA(input: { tarifa: number | null }): Promise<{ error?: string }> {
  const tarifa = tarifaSchema.safeParse(input.tarifa);
  if (!tarifa.success) return { error: "Tarifa inválida: use o valor em reais por kWh, como 0,95." };
  const [houseId, supabase] = await Promise.all([requireHouseId(), createClient()]);
  const { error } = await supabase.rpc("ha_definir_tarifa", { p_house: houseId, p_tarifa: tarifa.data });
  if (error) {
    console.error("[home-assistant] falha ao salvar a tarifa", { code: error.code });
    return { error: "Não foi possível salvar a tarifa." };
  }
  revalidatePath("/casa");
  revalidatePath("/analise");
  return {};
}

/**
 * A abertura do app (ver o layout): refaz o resumo do Home Assistant quando
 * ele esta ligado e o ultimo tem mais de alguns minutos. Os numeros so mudam
 * quando alguem usa o app (importa, lanca, sincroniza o banco), e e
 * justamente ai que isto roda - sem robo de madrugada nem chave de servico.
 */
export async function syncHomeAssistant(): Promise<void> {
  try {
    const [houseId, supabase] = await Promise.all([requireHouseId(), createClient()]);
    const { data, error } = await supabase
      .from("ha_integracoes")
      .select("resumo_em")
      .eq("house_id", houseId)
      .maybeSingle();
    if (error || !data) return;
    const ultimo = data.resumo_em ? new Date(data.resumo_em as string).getTime() : 0;
    if (Date.now() - ultimo < MINUTOS_ENTRE_RESUMOS * 60_000) return;
    await gravarResumo(supabase, houseId);
  } catch (e) {
    console.error("[home-assistant] resumo automatico falhou", { message: e instanceof Error ? e.message : "?" });
  }
}

async function gravarResumo(supabase: Awaited<ReturnType<typeof createClient>>, houseId: string): Promise<void> {
  const resumo = await calcularResumoHA(houseId);
  const { error } = await supabase.rpc("ha_gravar_resumo", { p_house: houseId, p_resumo: resumo });
  if (error) console.error("[home-assistant] falha ao gravar o resumo", { code: error.code });
}
