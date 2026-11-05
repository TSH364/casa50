import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { codigoDoPedido, hashDoCodigo } from "@/lib/ha-codigo";

/**
 * O que as rotas do Home Assistant tem em comum: o codigo do cabecalho vira
 * hash, e os erros do banco viram status HTTP que o Home Assistant mostra no
 * log. Sem sessao: quem responde sao as funcoes `ha_*` do banco, que acham a
 * casa pelo hash.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export function jsonHA(corpo: unknown, status = 200) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

export async function comCodigo(
  request: Request,
  fazer: (supabase: Supabase, hash: string) => Promise<Response>,
): Promise<Response> {
  const codigo = codigoDoPedido(request);
  if (!codigo) return jsonHA({ error: "Falta o código do Fluxo (Authorization: Bearer ...)." }, 401);
  try {
    return await fazer(await createClient(), hashDoCodigo(codigo));
  } catch (e) {
    return erroHA(e);
  }
}

/** Erro do banco (`{ code }`) para a resposta certa. */
export function erroHA(e: unknown): Response {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  if (code === "28000") return jsonHA({ error: "Código inválido. Gere outro na tela Casa do Fluxo." }, 401);
  if (code === "22023") {
    const message = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : "";
    return jsonHA({ error: message || "Dado inválido." }, 400);
  }
  if (code === "42883" || code === "PGRST202" || code === "42P01") {
    return jsonHA({ error: "O Fluxo ainda não tem a atualização do banco do Home Assistant." }, 503);
  }
  console.error("[home-assistant] falha na rota", { code });
  return jsonHA({ error: "Falha no Fluxo." }, 500);
}
