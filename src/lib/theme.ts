/**
 * O tema do app, escolhido por aparelho.
 *
 * Num cookie, e nao no banco nem no localStorage: o cookie chega ao servidor
 * junto com o pedido da pagina, e a pagina ja vem pintada na cor certa. Com
 * localStorage, o servidor mandaria o padrao e o navegador trocaria depois - um
 * clarao a cada tela, para quem escolheu o outro tema.
 *
 * Por aparelho, e nao por pessoa, de proposito: o mesmo casal pode querer o
 * claro no computador do trabalho e o escuro no celular a noite.
 */

export const THEME_COOKIE = "fluxo-tema";

export const THEMES = [
  { value: "claro", label: "Claro" },
  { value: "escuro", label: "Escuro" },
  { value: "sistema", label: "Seguir o celular" },
] as const;

export type ThemePref = (typeof THEMES)[number]["value"];

/**
 * O padrao e o claro, e o escuro fica como opcao. Quem ja escolheu um tema no
 * botao tem o cookie e continua com ele; so muda quem nunca escolheu.
 */
export const DEFAULT_THEME: ThemePref = "claro";

export function parseTheme(value: string | undefined | null): ThemePref {
  return THEMES.some((t) => t.value === value) ? (value as ThemePref) : DEFAULT_THEME;
}

/** O valor de `data-theme` no <html>, que o CSS le. */
export function themeAttribute(pref: ThemePref): "dark" | "light" | "system" {
  return pref === "claro" ? "light" : pref === "sistema" ? "system" : "dark";
}

/** O tema do aviso (sonner) e do navegador: o mesmo do app. */
export function toasterTheme(pref: ThemePref): "dark" | "light" | "system" {
  return themeAttribute(pref);
}

/** O proximo, na ordem do botao: claro -> escuro -> seguir o celular. */
export function nextTheme(pref: ThemePref): ThemePref {
  const i = THEMES.findIndex((t) => t.value === pref);
  return THEMES[(i + 1) % THEMES.length]!.value;
}

export function themeLabel(pref: ThemePref): string {
  return THEMES.find((t) => t.value === pref)!.label;
}
