import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { nextTheme, parseTheme, themeAttribute } from "@/lib/theme";

/**
 * O tema.
 *
 * O que guarda: o padrao continua escuro (ninguem abre o app mudado); cookie
 * estranho nao vira tema; o botao troca na hora e grava a escolha; e o CSS
 * claro redefine TODOS os tokens de cor do escuro - um esquecido ficaria
 * escuro no meio da tela clara.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

describe("preferência", () => {
  it("sem cookie, ou com lixo, é escuro", () => {
    expect(parseTheme(undefined)).toBe("escuro");
    expect(parseTheme("roxo")).toBe("escuro");
    expect(parseTheme("claro")).toBe("claro");
  });

  it("o ciclo passa pelos três e volta", () => {
    expect([nextTheme("escuro"), nextTheme("claro"), nextTheme("sistema")]).toEqual([
      "claro",
      "sistema",
      "escuro",
    ]);
    expect(themeAttribute("sistema")).toBe("system");
  });
});

describe("ThemeToggle", () => {
  it("troca o <html> na hora, grava o cookie e diz o que fez", async () => {
    const { ThemeToggle } = await import("@/components/theme-toggle");
    render(<ThemeToggle initial="escuro" />);
    fireEvent.click(screen.getByRole("button", { name: /Tema escuro/ }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.cookie).toContain("fluxo-tema=claro");
    expect(screen.getByRole("button", { name: /Tema claro\. Tocar muda para seguir o celular/ })).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("globals.css", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const tokens = (bloco: string) => new Set([...bloco.matchAll(/(--color-[a-z0-9-]+):/g)].map((m) => m[1]!));
  const tema = css.slice(css.indexOf("@theme"), css.indexOf("--font-sans"));
  const claro = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf("@media (prefers-color-scheme: light)"));
  const sistema = css.slice(css.indexOf(':root[data-theme="system"]'));

  // Os que nao mudam de proposito: a rampa do calendario e a tinta sobre ela.
  const FIXOS = new Set([
    "--color-day-1", "--color-day-2", "--color-day-3", "--color-day-4",
    "--color-on-day-dark", "--color-on-day-light",
  ]);

  it("o claro redefine todo token de cor do escuro (menos os fixos)", () => {
    const faltando = [...tokens(tema)].filter((t) => !FIXOS.has(t) && !tokens(claro).has(t));
    expect(faltando).toEqual([]);
  });

  it("\"seguir o celular\" usa exatamente os mesmos valores do claro", () => {
    const valores = (bloco: string) =>
      [...bloco.matchAll(/(--color-[a-z0-9-]+):\s*(#[0-9a-f]+)/gi)].map((m) => `${m[1]}=${m[2]}`).join(";");
    expect(valores(sistema.slice(0, sistema.indexOf("}")))).toBe(valores(claro.slice(0, claro.indexOf("}"))));
  });
});
