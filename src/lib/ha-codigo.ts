import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * O codigo com que o Home Assistant fala com o app.
 *
 * 32 bytes aleatorios: adivinhar um e impraticavel, entao o banco pode
 * achar a casa pelo hash sem limite de tentativas. O banco guarda so o
 * sha256 - quem le a tabela nao consegue usar o codigo.
 */

const FORMATO = /^fluxo_[A-Za-z0-9_-]{43}$/;

export function novoCodigoHA(): string {
  return `fluxo_${randomBytes(32).toString("base64url")}`;
}

export function hashDoCodigo(codigo: string): string {
  return createHash("sha256").update(codigo, "utf8").digest("hex");
}

/** O codigo do cabecalho `Authorization: Bearer ...`, ou `null` se nao ha um valido. */
export function codigoDoPedido(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization")?.trim() ?? "");
  const codigo = m?.[1] ?? null;
  return codigo && FORMATO.test(codigo) ? codigo : null;
}
