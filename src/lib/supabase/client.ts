"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Cliente Supabase do browser.
 *
 * Usa a chave publicavel (anon). Isso e seguro porque o isolamento entre
 * casas e imposto por Row Level Security no banco - a chave nao concede
 * acesso a nada alem do que as policies permitem para o usuario logado.
 */
export function createClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
