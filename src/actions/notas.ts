"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { GmailError, credenciaisGoogle, tokenDeAcesso } from "@/lib/gmail";
import { casarPendentes, planilhasDaCasa, sincronizarPlanilha } from "@/data/notas";
import { idDaPlanilha } from "@/domain/notas";
import { requireHouseId } from "./shared";

/**
 * Notas fiscais: a planilha que o Gemini da casa preenche, lida pelo login
 * do Google do secretario, e cada nota ligada a compra da fatura.
 *
 * Roda junto com a leitura do Gmail (a cada poucas horas, quando alguem abre
 * o app) e nao depende da IA do app: quem leu os e-mails foi o Gemini.
 */

function traduzir(code: string | undefined, message: string | undefined, padrao: string): string {
  if (code === "42501") return "Só quem participa da casa liga a planilha.";
  if (code === "22023" && message) return message;
  if (code === "42883" || code === "PGRST202") return "Falta aplicar a atualização do banco das notas fiscais.";
  return padrao;
}

/** Guardar (ou tirar, com texto vazio) a planilha de notas de quem esta usando o app. */
export async function salvarPlanilhaDeNotas(input: { link: string }): Promise<{ ok?: true; error?: string }> {
  const link = String(input.link ?? "").trim();
  const id = link ? idDaPlanilha(link) : null;
  if (link && !id) return { error: "Cole o link da planilha do Google (docs.google.com/spreadsheets/…)." };
  const [houseId, supabase] = await Promise.all([requireHouseId(), createClient()]);
  const { error } = await supabase.rpc("set_nf_sheet", { p_house: houseId, p_sheet_id: id });
  if (error) {
    console.error("[notas] falha ao guardar a planilha", { code: error.code });
    return { error: traduzir(error.code, error.message, "Não foi possível guardar a planilha.") };
  }
  revalidatePath("/casa");
  return { ok: true };
}

/** O botao "Ler notas agora", na Casa: todas as planilhas da casa. */
export async function lerNotasAgora(): Promise<{ novas: number; ligadas: number; error?: string }> {
  const cred = credenciaisGoogle();
  if (!cred) return { novas: 0, ligadas: 0, error: "O acesso ao Google ainda não foi configurado no servidor." };
  const [houseId, supabase] = await Promise.all([requireHouseId(), createClient()]);
  const { data, error } = await supabase.rpc("email_connection_secrets", { p_house: houseId });
  if (error) return { novas: 0, ligadas: 0, error: "Não foi possível ler as conexões do Google." };
  const planilhas = await planilhasDaCasa(supabase, houseId);
  let novas = 0;
  let erro: string | undefined;
  for (const c of (data ?? []) as { id: string; refresh_token: string }[]) {
    const planilha = planilhas.get(c.id);
    if (!planilha) continue;
    try {
      const token = await tokenDeAcesso(c.refresh_token, cred);
      novas += await sincronizarPlanilha(supabase, houseId, c.id, planilha, token);
    } catch (e) {
      erro = e instanceof GmailError ? e.message : "Falha ao ler a planilha.";
      await supabase.rpc("mark_nf_sync", { p_connection: c.id, p_error: erro });
    }
  }
  const ligadas = await casarPendentes(supabase, houseId);
  return { novas, ligadas, ...(erro ? { error: erro } : {}) };
}
