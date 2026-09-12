import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/** Respostas que significam "tente de novo", e nao "deu errado". */
const TRANSITORIOS = new Set([408, 425, 429, 500, 502, 503, 504]);
/** Uma tentativa extra, e so uma. Duas ja seriam insistir num problema real. */
const ESPERA_MS = 400;

/**
 * `fetch` que repete uma vez quando a resposta e transitoria.
 *
 * MEDIDO nos logs reais do projeto: quatro requisicoes falharam com 504 em
 * 4.844 - duas as 01:15 e duas as 03:45 - e TODAS pararam em ~5 segundos
 * (5.024, 5.020, 5.018 e 5.399 ms). Os logs do Postgres nao registram nenhuma
 * consulta nesses instantes: o banco nunca viu o pedido, quem desistiu foi o
 * gateway. Nada no app causou, e nada no app conserta - mas uma tela inteira
 * deixava de carregar por causa disso, porque uma leitura que falha derruba o
 * componente de servidor que a pediu.
 *
 * Uma repeticao cobre a falha transitoria sem esconder falha de verdade: se a
 * segunda tentativa tambem falhar, o erro sobe e a tela diz o que houve.
 *
 * Fica aqui, na criacao do cliente, e nao espalhado por quinze funcoes de
 * consulta - uma copia esquecida seria justamente a tela que continua caindo.
 */
async function fetchComUmaRepeticao(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    const resposta = await fetch(input, init);
    if (!TRANSITORIOS.has(resposta.status)) return resposta;
    await new Promise((r) => setTimeout(r, ESPERA_MS));
    return await fetch(input, init);
  } catch (erro) {
    // Falha de rede tambem e transitoria. A segunda falha sobe como sempre.
    await new Promise((r) => setTimeout(r, ESPERA_MS));
    if (erro instanceof Error && erro.name === "AbortError") throw erro;
    return await fetch(input, init);
  }
}

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
      global: { fetch: fetchComUmaRepeticao },
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
