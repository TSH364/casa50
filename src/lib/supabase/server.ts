import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * Cliente Supabase para Server Components, Route Handlers e Server Actions.
 * Sempre `await` - `cookies()` e assincrono a partir do Next 15.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components nao podem escrever cookies. A renovacao do
            // token acontece no middleware, entao ignorar aqui e correto.
          }
        },
      },
    },
  );
}

/**
 * Usuario autenticado, ou `null`.
 *
 * Usa `getUser()` e nao `getSession()`: getSession le o cookie sem validar a
 * assinatura no servidor de auth, o que e falsificavel. Em codigo de servidor,
 * so getUser() e confiavel.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
