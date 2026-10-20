import "server-only";
import type { MensagemGmailBruta } from "@/domain/secretario";

/**
 * O Gmail, so o que o secretario usa: o login do Google (OAuth), trocar o
 * refresh token por um token de acesso (vale 1 hora), saber o endereco da
 * conta, listar mensagens e ler uma. Roda no servidor: o Client Secret e os
 * tokens nunca vao para o navegador.
 *
 * Permissoes pedidas, so de leitura: `gmail.readonly` (o app nao manda, nao
 * apaga, nao marca como lido) e `spreadsheets.readonly` (a planilha de notas
 * fiscais que o Gemini da casa preenche - ver `domain/notas.ts`).
 */

const ESCOPO = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
].join(" ");
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
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
  return pedirUrl<T>(`${API}${caminho}`, accessToken, "Gmail");
}

async function pedirUrl<T>(url: string, accessToken: string, servico: "Gmail" | "Planilhas"): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(LIMITE_MS),
      cache: "no-store",
    });
  } catch {
    throw new GmailError(`O Google (${servico}) não respondeu. Tente de novo em instantes.`);
  }
  if (r.status === 401) {
    throw new GmailError("O Google recusou a leitura. Conecte o Google de novo em Casa.", true);
  }
  if (r.status === 403) {
    // Sem a permissao (a conexao e de antes das planilhas) ou sem acesso ao arquivo.
    throw new GmailError(
      servico === "Planilhas"
        ? "Sem acesso à planilha. Conecte o Google de novo em Casa (para dar acesso às planilhas) e confira se a planilha é da mesma conta."
        : "O Gmail recusou a leitura. Conecte o Google de novo em Casa.",
      true,
    );
  }
  if (r.status === 404) throw new GmailError(`O Google não achou ${servico === "Planilhas" ? "a planilha" : "o e-mail"}.`);
  if (!r.ok) throw new GmailError(`O Google (${servico}) respondeu com erro (${r.status}).`);
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

/**
 * As linhas da planilha de notas: a aba "Notas Fiscais" quando existe, senao
 * a primeira. Valores crus (numero e numero), datas como texto.
 */
export async function lerPlanilha(accessToken: string, planilhaId: string): Promise<unknown[][]> {
  const id = encodeURIComponent(planilhaId);
  const meta = await pedirUrl<{ sheets?: { properties?: { title?: string } }[] }>(
    `${SHEETS}/${id}?fields=sheets.properties.title`,
    accessToken,
    "Planilhas",
  );
  const abas = (meta.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
  const aba = abas.find((t) => /notas? fisca/i.test(t)) ?? abas[0];
  if (!aba) return [];
  const q = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
  const r = await pedirUrl<{ values?: unknown[][] }>(
    `${SHEETS}/${id}/values/${encodeURIComponent(`'${aba.replace(/'/g, "''")}'!A1:Z3000`)}?${q}`,
    accessToken,
    "Planilhas",
  );
  return r.values ?? [];
}
