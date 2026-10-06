import "server-only";
import { imagemDaPagina } from "@/domain/radar";
import { isBlockedHost } from "@/lib/net";

/**
 * Abre a pagina do anuncio e devolve a imagem que a loja publica para
 * compartilhar (ver `imagemDaPagina`).
 *
 * O endereco veio da busca na web, entao passa pela mesma barreira da agenda:
 * so https, nunca rede interna, e cada redirecionamento conferido de novo.
 * Le no maximo o comeco da pagina - as metas ficam no <head>. Qualquer falha
 * (loja que bloqueia robo, tempo esgotado) e so "sem imagem": nunca derruba a
 * conferencia do preco.
 */
const LIMITE_BYTES = 400_000;

export async function buscarImagemDoProduto(url: string, timeoutMs = 6_000): Promise<string | null> {
  try {
    let alvo = url;
    for (let salto = 0; salto < 4; salto += 1) {
      const u = new URL(alvo);
      if (u.protocol !== "https:" || isBlockedHost(u.hostname)) return null;
      const r = await fetch(alvo, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9",
          // Varias lojas so mandam as metas de compartilhamento para quem se
          // apresenta como navegador ou como leitor de link.
          "User-Agent": "Mozilla/5.0 (compatible; FluxoRadar/1.0)",
        },
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (!loc) return null;
        alvo = new URL(loc, alvo).toString();
        continue;
      }
      if (!r.ok || !r.body) return null;
      const html = await lerComeco(r.body, LIMITE_BYTES);
      const img = imagemDaPagina(html, alvo);
      if (!img) return null;
      const iu = new URL(img);
      return isBlockedHost(iu.hostname) ? null : img;
    }
    return null;
  } catch {
    return null;
  }
}

async function lerComeco(body: ReadableStream<Uint8Array>, limite: number): Promise<string> {
  const leitor = body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limite) {
      const { done, value } = await leitor.read();
      if (done || !value) break;
      partes.push(value);
      total += value.byteLength;
    }
  } finally {
    await leitor.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(partes.map((p) => Buffer.from(p))));
}
