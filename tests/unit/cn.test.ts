import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

/**
 * A escala de tipo do app no `cn`: tamanho e cor de texto nao sao o mesmo
 * grupo. Antes, `text-legenda text-ink-muted` perdia o tamanho em silencio.
 */
describe("cn", () => {
  it("mantém o tamanho da escala junto com a cor", () => {
    expect(cn("text-legenda", "text-ink-muted")).toBe("text-legenda text-ink-muted");
    expect(cn("text-corpo font-bold", "text-danger")).toBe("text-corpo font-bold text-danger");
  });
  it("dois tamanhos: o último vence, como sempre", () => {
    expect(cn("text-legenda", "text-titulo")).toBe("text-titulo");
    expect(cn("text-sm", "text-corpo")).toBe("text-corpo");
  });
});
