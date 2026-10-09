import { siteUrl } from "@/lib/env";

/** O cookie do `state` do login do Google (ver `conectar`). */
export const COOKIE_ESTADO = "gmail_oauth_state";

/** O endereco de retorno cadastrado no Google Cloud. */
export function retornoDoGmail(): string {
  return `${siteUrl()}/api/gmail/retorno`;
}
