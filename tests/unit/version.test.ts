import { describe, expect, it } from "vitest";
import { buildLabel, versionLabel, type BuildInfo } from "@/lib/version";

function info(overrides: Partial<BuildInfo> = {}): BuildInfo {
  return {
    version: "0.2.0",
    sha: "ceef648",
    ref: "main",
    env: "production",
    builtAt: "2026-09-11T03:20:00Z",
    ...overrides,
  };
}

describe("versionLabel", () => {
  it("esconde o patch zero, que não informa nada", () => {
    expect(versionLabel(info({ version: "0.2.0" }))).toBe("v0.2");
    expect(versionLabel(info({ version: "1.0.0" }))).toBe("v1.0");
  });

  it("mostra o patch quando ele distingue duas entregas", () => {
    expect(versionLabel(info({ version: "0.2.1" }))).toBe("v0.2.1");
    expect(versionLabel(info({ version: "0.2.14" }))).toBe("v0.2.14");
  });

  it("sem número, cai no commit em vez de mostrar 'v'", () => {
    // Build fora da Vercel, ou package.json ilegível: melhor o hash sozinho
    // do que um rótulo vazio que parece defeito.
    expect(versionLabel(info({ version: "" }))).toBe("ceef648");
  });

  it("aceita versão sem patch", () => {
    expect(versionLabel(info({ version: "0.3" }))).toBe("v0.3");
  });
});

describe("buildLabel", () => {
  it("põe o número na frente e o commit logo atrás", () => {
    const label = buildLabel(info());
    expect(label.startsWith("Versão v0.2 · ceef648")).toBe(true);
    expect(label).toContain("produção");
    expect(label).toContain("build de");
  });

  it("o commit continua presente mesmo sem número de versão", () => {
    // É ele que identifica o build sem ambiguidade quando algo dá errado.
    expect(buildLabel(info({ version: "" }))).toContain("ceef648");
  });

  it("omite o que não existe, sem deixar separador solto", () => {
    const label = buildLabel(info({ ref: "", env: "", builtAt: "" }));
    expect(label).toBe("Versão v0.2 · ceef648");
  });
});
