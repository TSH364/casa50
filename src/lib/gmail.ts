import "server-only";
import type { MensagemGmailBruta } from "@/domain/secretario";

/**
 * O Gmail, so o que o secretario usa: o login do Google (OAuth), trocar o
 * refresh token por um token de acesso (vale 1 hora), saber o endereco da
 * conta, listar mensagens e ler uma. Roda no servidor: o Client Secret e os
 * tokens nunca vao para o navegador.
 *
 * Permissao pedida: `gmail.readonly`. O app LE; nao manda, nao apaga, nao
 * marca como lido.
 */

const ESCOPO = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const LIMITE_MS = 15_000;

export class GmailError extends Error {
  constructor(
    message: string,
    /** O Google nao aceita mais a autorizacao: so conectando de novo. */
    readonly reconectar = false,
  ) {
    super(message);
  }
}

/** As credenciais do app no Google Cloud. Sem elas, o secretario fica desligado. */
export function credenciaisGoogle(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** O endereco do Google para a pessoa autorizar a leitura do Gmail. */
export function urlDeAutorizacao(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ESCOPO,
    // offline + consent: o Google so devolve o refresh token assim, e sem ele
    // o app teria de pedir login a cada hora.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH}?${q}`;
}

async function postarToken(corpo: Record<string, string>): Promise<Record<string, unknown>> {
  let r: Response;
  try {
    r = await fetch(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(corpo),
      signal: AbortSignal.timeout(LIMITE_MS),
      cache: "no-store",
    });
  } catch {
    throw new GmailError("O Google não respondeu. Tente de novo em instantes.");
  }
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    // invalid_grant: a pessoa revogou, trocou a senha, ou o app esta em modo
    // de teste no Google (a autorizacao vence em 7 dias).
    if (json.error === "invalid_grant") {
      throw new GmailError("O Google não aceita mais a autorização. Conecte o Gmail de novo em Casa.", true);
    }
    throw new GmailError(`O Google recusou o pedido (${r.status}).`);
  }
  return json;
}

/** O codigo do retorno do login -> refresh token. */
export async function trocarCodigo(
  codigo: string,
  redirectUri: string,
  cred: { clientId: string; clientSecret: string },
): Promise<{ refreshToken: string; accessToken: string }> {
  const json = await postarToken({
    code: codigo,
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : "";
  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  if (!refreshToken || !accessToken) throw new GmailError("O Google não devolveu a autorização completa.");
  return { refreshToken, accessToken };
}

/** Refresh token -> token de acesso de 1 hora. */
export async function tokenDeAcesso(
  refreshToken: string,
  cred: { clientId: string; clientSecret: string },
): Promise<string> {
  const json = await postarToken({
    refresh_token: refreshToken,
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    grant_type: "refresh_token",
  });
  if (typeof json.access_token !== "string") throw new GmailError("O Google não devolveu o acesso.");
  return json.access_token;
}

async function pedir<T>(caminho: string, accessToken: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API}${caminho}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(LIMITE_MS),
      cache: "no-store",
    });
  } catch {
    throw new GmailError("O Gmail não respondeu. Tente de novo em instantes.");
  }
  if (r.status === 401 || r.status === 403) {
    throw new GmailError("O Gmail recusou a leitura. Conecte o Gmail de novo em Casa.", true);
  }
  if (!r.ok) throw new GmailError(`O Gmail respondeu com erro (${r.status}).`);
  return (await r.json()) as T;
}

export async function enderecoDaConta(accessToken: string): Promise<string> {
  const r = await pedir<{ emailAddress?: string }>("/profile", accessToken);
  if (!r.emailAddress) throw new GmailError("O Gmail não disse de quem é a conta.");
  return r.emailAddress;
}

/** Os ids das mensagens que batem com a busca, das mais novas para as mais antigas. */
export async function listarMensagens(accessToken: string, busca: string, maximo: number): Promise<string[]> {
  const q = new URLSearchParams({ q: busca, maxResults: String(Math.min(maximo, 100)) });
  const r = await pedir<{ messages?: { id: string }[] }>(`/messages?${q}`, accessToken);
  return (r.messages ?? []).map((m) => m.id);
}

export async function lerMensagem(accessToken: string, id: string): Promise<MensagemGmailBruta> {
  return pedir<MensagemGmailBruta>(`/messages/${encodeURIComponent(id)}?format=full`, accessToken);
}
