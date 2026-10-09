import { NextResponse } from "next/server";
import { requireHouseId } from "@/actions/shared";
import { credenciaisGoogle, urlDeAutorizacao } from "@/lib/gmail";
import { siteUrl } from "@/lib/env";
import { COOKIE_ESTADO, retornoDoGmail } from "../shared";

/**
 * "Conectar meu Gmail": manda a pessoa para o Google autorizar a leitura.
 *
 * O `state` e um numero aleatorio guardado num cookie so do servidor; o
 * retorno confere os dois. Sem isso, um link forjado poderia ligar o Gmail de
 * outra pessoa a esta casa.
 *
 * Sempre pelo endereco de producao: e o unico cadastrado no Google como
 * retorno, e o cookie precisa estar no mesmo endereco que o retorno.
 */
export async function GET(req: Request) {
  const base = siteUrl();
  if (new URL(req.url).origin !== new URL(base).origin) {
    return NextResponse.redirect(`${base}/api/gmail/conectar`);
  }
  try {
    await requireHouseId();
  } catch {
    return NextResponse.redirect(`${base}/inicio`);
  }
  const cred = credenciaisGoogle();
  if (!cred) return NextResponse.redirect(`${base}/casa?gmail=sem-configuracao`);

  const estado = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  const res = NextResponse.redirect(urlDeAutorizacao(cred.clientId, retornoDoGmail(), estado));
  res.cookies.set(COOKIE_ESTADO, estado, {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/api/gmail",
    maxAge: 600,
  });
  return res;
}
