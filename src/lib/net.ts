/**
 * Barreira para URLs que quem usa o app fornece.
 *
 * O servidor busca a agenda de dentro da rede da hospedagem. Sem esta
 * checagem, colar `https://169.254.169.254/latest/meta-data/` no campo de
 * endereco transformaria o botao "Conectar agenda" numa janela para a rede
 * interna - o servidor faria o pedido, e o conteudo voltaria para a tela.
 *
 * A checagem e por NOME, e por isso e parcial de proposito: um dominio publico
 * que resolve para um IP privado passaria por aqui. Ela cobre o caso direto e
 * o do redirecionamento (que a busca refaz salto a salto), que sao os que
 * dependem so de colar um texto no formulario.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "") return true;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    // 0.0.0.0/8, 10/8 e 127/8; 169.254/16 (link-local, onde ficam os metadados
    // das nuvens); 172.16/12; 192.168/16; e tudo de 224 para cima (multicast).
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }

  // IPv6: fc00::/7 (unico local) e fe80::/10 (link-local).
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;

  return false;
}
