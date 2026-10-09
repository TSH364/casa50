import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireHouseId } from "@/actions/shared";
import { syncSecretario } from "@/actions/secretario";
import { GmailError, credenciaisGoogle, enderecoDaConta, trocarCodigo } from "@/lib/gmail";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/env";
import { COOKIE_ESTADO, retornoDoGmail } from "../shared";

/**
 * A volta do Google: confere o `state`, troca o codigo pelo refresh token,
 * descobre o endereco da conta e guarda tudo no Vault (`set_email_connection`,
 * com a sessao de quem conectou). Depois, a primeira leitura - sem esperar.
 */
export const maxDuration = 30;

function voltar(motivo: string) {
  const res = NextResponse.redirect(`${siteUrl()}/casa?gmail=${motivo}`);
  res.cookies.delete({ name: COOKIE_ESTADO, path: "/api/gmail" });
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const estado = url.searchParams.get("state");
  const guardado = (await cookies()).get(COOKIE_ESTADO)?.value;
  if (!estado || !guardado || estado !== guardado) return voltar("expirou");
  if (url.searchParams.get("error")) return voltar("recusado");

  const codigo = url.searchParams.get("code");
  const cred = credenciaisGoogle();
  if (!codigo) return voltar("recusado");
  if (!cred) return voltar("sem-configuracao");

  let houseId: string;
  try {
    houseId = await requireHouseId();
  } catch {
    return voltar("sem-casa");
  }

  try {
    const { refreshToken, accessToken } = await trocarCodigo(codigo, retornoDoGmail(), cred);
    const email = await enderecoDaConta(accessToken);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_email_connection", {
      p_house: houseId,
      p_email: email,
      p_refresh_token: refreshToken,
    });
    if (error) {
      console.error("[secretario] falha ao guardar a conexao", { code: error.code });
      return voltar(error.code === "42883" || error.code === "PGRST202" ? "sem-banco" : "falhou");
    }
  } catch (e) {
    console.error("[secretario] falha no retorno do Google", { message: e instanceof GmailError ? e.message : "?" });
    return voltar("falhou");
  }

  after(syncSecretario);
  const res = NextResponse.redirect(`${siteUrl()}/secretario?gmail=conectado`);
  res.cookies.delete({ name: COOKIE_ESTADO, path: "/api/gmail" });
  return res;
}
