import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MODEL } from "@/lib/openrouter";

/**
 * De onde vem a chave do OpenRouter, e qual modelo usar (secao 15).
 *
 * DUAS FONTES, e a ordem entre elas e deliberada:
 *
 *   1. VARIAVEL DE AMBIENTE (`OPENROUTER_API_KEY`, na Vercel). Vence sempre.
 *      E a opcao mais fechada: a chave nunca passa pelo banco, e nenhuma
 *      sessao de usuario consegue le-la.
 *   2. A CHAVE DA CASA, colada na tela da Casa e guardada no Vault do
 *      Supabase, criptografada. Mais pratica - troca sem deploy -, com um
 *      limite dito na migracao `20260925000001_chave_de_ia.sql`: um membro
 *      logado que chame a funcao de leitura direto pela API consegue ve-la.
 *
 * Quem configurou a Vercel escolheu a opcao mais fechada, e a tela nao deixa
 * que uma chave colada ali passe por cima disso.
 */

export type AiKeySource = "servidor" | "casa";

export interface AiStatus {
  /** De onde a chave viria, ou `null` se nao ha chave nenhuma. */
  source: AiKeySource | null;
  /** "…a1b2" da chave da casa. Nulo para a do servidor, que o app nao mostra. */
  keyHint: string | null;
  /** Modelo da leitura de orcamento, ja resolvido. */
  quoteModel: string;
  /** O modelo veio da variavel de ambiente, e a tela nao pode troca-lo. */
  quoteModelLocked: boolean;
}

function chaveDoServidor(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

function modeloDoServidor(): string | null {
  return process.env.OPENROUTER_MODEL?.trim() || null;
}

/**
 * O estado da configuracao, SEM a chave.
 *
 * E o que as telas usam: para saber se oferecem a leitura com IA e o que
 * mostrar na Casa. Nao decripta nada - le so o final da chave e o modelo, que
 * nao sao segredo -, e por isso pode rodar a cada carregamento de pagina.
 */
export async function getAiStatus(houseId: string): Promise<AiStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("house_ai_settings")
    .select("key_hint, quote_model")
    .eq("house_id", houseId)
    .maybeSingle();

  const doServidor = chaveDoServidor();
  const modeloFixo = modeloDoServidor();

  return {
    source: doServidor ? "servidor" : data?.key_hint ? "casa" : null,
    keyHint: doServidor ? null : ((data?.key_hint as string | null) ?? null),
    quoteModel: modeloFixo ?? ((data?.quote_model as string | null) || DEFAULT_MODEL),
    quoteModelLocked: modeloFixo !== null,
  };
}

/**
 * A chave em texto, para uma chamada.
 *
 * So no servidor, so no momento da chamada, e nunca devolvida ao navegador.
 * A funcao do banco so entrega a quem pode escrever na casa; para os demais,
 * volta `null`, e a IA fica indisponivel para eles.
 */
export async function getAiKey(houseId: string): Promise<string | null> {
  const doServidor = chaveDoServidor();
  if (doServidor) return doServidor;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_key_for_house", { p_house: houseId });
  if (error) {
    console.error("[ia] falha ao ler a chave da casa", { code: error.code });
    return null;
  }
  return typeof data === "string" && data !== "" ? data : null;
}
