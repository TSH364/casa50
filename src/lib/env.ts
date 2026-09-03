import { z } from "zod";

/**
 * Validacao das variaveis de ambiente.
 *
 * Falhar aqui, na inicializacao, com uma mensagem que diz qual variavel falta
 * e muito melhor do que falhar no meio de uma consulta com "Invalid API key".
 *
 * As variaveis NEXT_PUBLIC_* precisam ser lidas por acesso literal
 * (`process.env.NEXT_PUBLIC_X`) e nao por indice dinamico: o Next substitui
 * essas ocorrencias em tempo de build e uma leitura dinamica vira `undefined`
 * no bundle do cliente.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url({
    message: "NEXT_PUBLIC_SUPABASE_URL ausente ou invalida. Veja .env.example.",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, {
    message: "NEXT_PUBLIC_SUPABASE_ANON_KEY ausente. Veja .env.example.",
  }),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

/**
 * Chave de servico: ignora RLS. Só pode ser lida em codigo de servidor.
 * A funcao existe para que o valor nunca apareca no escopo de modulo, o que
 * facilitaria vazar para um bundle de cliente por importacao acidental.
 */
export function serviceRoleKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nao pode ser lida no cliente.");
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente. Veja .env.example.");
  return key;
}
