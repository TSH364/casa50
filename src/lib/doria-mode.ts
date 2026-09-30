/**
 * Como a Dor.IA abre pelo botao central: do jeito usado por ultimo (voz ou
 * texto), por aparelho. E a primeira vez pela voz passa por uma tela que
 * explica antes de o navegador pedir o microfone.
 *
 * No localStorage, e nao num cookie: so o navegador precisa saber, e um
 * armazenamento bloqueado (aba anonima) so faz cair no padrao.
 */

export type DoriaModo = "voz" | "texto";

const MODO = "fluxo-doria-modo";
const VOZ_OK = "fluxo-doria-voz-ok";

function ler(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string) {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    // Sem armazenamento, so nao lembra.
  }
}

/** O ultimo jeito usado; na primeira vez, a voz. */
export function ultimoModo(): DoriaModo {
  return ler(MODO) === "texto" ? "texto" : "voz";
}

export function lembrarModo(modo: DoriaModo) {
  gravar(MODO, modo);
}

/** Ja passou pela explicacao do microfone neste aparelho? */
export function vozApresentada(): boolean {
  return ler(VOZ_OK) === "1";
}

export function marcarVozApresentada() {
  gravar(VOZ_OK, "1");
}

export function parseModo(valor: string | undefined | null): DoriaModo | null {
  return valor === "voz" || valor === "texto" ? valor : null;
}
