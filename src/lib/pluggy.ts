import "server-only";
import type { PluggyAccount, PluggyTransaction } from "@/domain/pluggy";

/**
 * A API da Pluggy, so o que a sincronizacao usa: trocar as credenciais por
 * uma chave (vale 2 horas), listar as contas de um item e as transacoes de
 * uma conta. Roda no servidor: o Client Secret nunca vai para o navegador.
 */

const API = "https://api.pluggy.ai";
const LIMITE_MS = 15_000;
const PAGINA = 500;
/** Paginas por conta, no maximo: 45 dias de cartao cabem folgados numa. */
const MAX_PAGINAS = 10;

export class PluggyError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

async function pedir<T>(caminho: string, init: RequestInit & { apiKey?: string } = {}): Promise<T> {
  const { apiKey, ...resto } = init;
  let r: Response;
  try {
    r = await fetch(`${API}${caminho}`, {
      ...resto,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(apiKey ? { "X-API-KEY": apiKey } : {}),
      },
      signal: AbortSignal.timeout(LIMITE_MS),
      cache: "no-store",
    });
  } catch {
    throw new PluggyError("A Pluggy não respondeu. Tente de novo em instantes.", null);
  }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw new PluggyError("A Pluggy recusou as credenciais. Confira o Client ID e o Client Secret.", r.status);
    }
    if (r.status === 404) {
      throw new PluggyError("A Pluggy não achou esse Item ID. Confira no Dashboard da Pluggy.", r.status);
    }
    throw new PluggyError(`A Pluggy respondeu com erro (${r.status}).`, r.status);
  }
  return (await r.json()) as T;
}

/** Credenciais da aplicacao -> chave de API (2 horas). */
export async function pluggyAuth(clientId: string, clientSecret: string): Promise<string> {
  const { apiKey } = await pedir<{ apiKey?: string }>("/auth", {
    method: "POST",
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!apiKey) throw new PluggyError("A Pluggy não devolveu a chave de acesso.", null);
  return apiKey;
}

export async function pluggyAccounts(apiKey: string, itemId: string): Promise<PluggyAccount[]> {
  const r = await pedir<{ results?: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`, { apiKey });
  return (r.results ?? []).map((a) => ({ ...a, itemId }));
}

export async function pluggyTransactions(
  apiKey: string,
  accountId: string,
  from: string,
  to: string,
): Promise<PluggyTransaction[]> {
  const todas: PluggyTransaction[] = [];
  for (let page = 1; page <= MAX_PAGINAS; page += 1) {
    const q = new URLSearchParams({ accountId, from, to, pageSize: String(PAGINA), page: String(page) });
    const r = await pedir<{ results?: PluggyTransaction[]; totalPages?: number }>(`/transactions?${q}`, { apiKey });
    todas.push(...(r.results ?? []));
    if (!r.totalPages || page >= r.totalPages) break;
  }
  return todas;
}
