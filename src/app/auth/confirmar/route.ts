import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino do link de confirmacao de e-mail.
 * Troca o token de uso unico por uma sessao e leva o usuario para o inicio.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}/inicio`);
    }
    console.warn("[auth] confirmacao invalida", { code: error.code });
  }

  const url = new URL("/entrar", origin);
  url.searchParams.set("erro", "link-invalido");
  return NextResponse.redirect(url);
}
