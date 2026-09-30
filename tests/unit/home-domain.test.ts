import { describe, expect, it } from "vitest";
import { doriBarra, escolherAvisos, montarRamos, tintaSobre } from "@/domain/home";

/**
 * As regras do novo Inicio.
 *
 * O que guarda: a Dori reage ao ritmo e nao ao tamanho (o rabinho so num mes
 * fechado abaixo do previsto); o comeco do mes nao infla a barra; passar do
 * previsto vira texto; os avisos sao no maximo dois, do mais grave ao menor;
 * os ramos sao proporcionais, com "Outras" juntando o resto; e o texto sobre
 * a cor de uma categoria sempre tem contraste.
 */

// 15 de setembro de 2026, meio-dia: metade do mes (15/30 = 50%).
const HOJE = new Date(2026, 8, 15, 12);

describe("barra da Dori", () => {
  const base = { month: "2026-09" as const, hasData: true, now: HOJE, expectedCents: 1_000_000 };

  it("no ritmo: calma; acima (com folga de 3 pontos): alerta", () => {
    const calma = doriBarra({ ...base, spentCents: 480_000 });
    expect(calma).toMatchObject({ estado: "ritmo", pct: 48, ritmo: 50, alerta: false });
    expect(doriBarra({ ...base, spentCents: 530_000 }).estado).toBe("ritmo");
    const acima = doriBarra({ ...base, spentCents: 540_000 });
    expect(acima).toMatchObject({ estado: "acima", alerta: true });
    expect(acima.rotulo).toMatch(/54% do previsto; ritmo esperado para hoje: 50%; acima do ritmo/);
  });

  it("começo do mês: abaixo de 15% não infla a barra", () => {
    const inicio = doriBarra({ ...base, now: new Date(2026, 8, 2, 12), spentCents: 40_000 });
    expect(inicio).toMatchObject({ estado: "pequena", pct: 4, alerta: false });
  });

  it("passou do previsto: o excesso vira texto, e é alerta", () => {
    const passou = doriBarra({ ...base, spentCents: 1_120_000 });
    expect(passou).toMatchObject({ estado: "passou", pct: 112, excessoCents: 120_000, alerta: true });
    expect(passou.rotulo).toMatch(/1\.200,00 acima do previsto/);
  });

  it("mês fechado abaixo do previsto: rabinho; acima: continua 'passou'", () => {
    const agosto = { ...base, month: "2026-08" as const };
    expect(doriBarra({ ...agosto, spentCents: 910_000 })).toMatchObject({ estado: "fechou", ritmo: null, alerta: false });
    expect(doriBarra({ ...agosto, spentCents: 1_050_000 }).estado).toBe("passou");
  });

  it("casa sem dados, ou sem histórico para prever", () => {
    expect(doriBarra({ ...base, hasData: false, spentCents: 0 }).estado).toBe("vazio");
    expect(doriBarra({ ...base, expectedCents: null, spentCents: 50_000 })).toMatchObject({
      estado: "sem-previsao",
      rotulo: expect.stringMatching(/500,00\. Ainda sem previsão/),
    });
  });
});

describe("avisos", () => {
  it("no máximo dois: estourou, depois conta que faltou, depois perto do limite", () => {
    const avisos = escolherAvisos({
      orcamentos: [
        { nome: "Mercado", categoryId: "c1", ratio: 0.92, overCents: 0 },
        { nome: "Lazer", categoryId: "c2", ratio: 1.12, overCents: 12_000 },
        { nome: "Casa", categoryId: "c3", ratio: 0.4, overCents: 0 },
      ],
      contasFaltando: [{ nome: "Internet" }],
    });
    expect(avisos.map((a) => [a.tipo, a.texto])).toEqual([
      ["passou", expect.stringMatching(/^Lazer passou R\$\s*120,00 do limite\.$/)],
      ["conta", "Internet não apareceu na fatura deste mês."],
    ]);
    expect(avisos[0]!.href).toBe("/extratos?categoria=c2");
  });

  it("nada fora do normal: nenhum aviso", () => {
    expect(escolherAvisos({ orcamentos: [{ nome: "Casa", categoryId: "c", ratio: 0.5, overCents: 0 }], contasFaltando: [] })).toEqual([]);
  });
});

describe("ramos", () => {
  it("proporcionais à maior, com mínimo; o que passa de cinco vira 'Outras'", () => {
    const { ramos, totalCents } = montarRamos([
      { nome: "A", cor: "#111111", cents: 400 },
      { nome: "B", cor: "#222222", cents: 200 },
      { nome: "C", cor: "#333333", cents: 100 },
      { nome: "D", cor: "#444444", cents: 100 },
      { nome: "E", cor: "#555555", cents: 50 },
      { nome: "F", cor: "#666666", cents: 50 },
      { nome: "Estorno", cor: "#777777", cents: -30 },
    ]);
    expect(totalCents).toBe(900);
    expect(ramos.map((r) => r.nome)).toEqual(["A", "B", "C", "D", "Outras"]);
    expect(ramos[0]!.largura).toBe(1);
    expect(ramos[1]!.largura).toBe(0.5);
    expect(ramos[2]!.largura).toBe(0.34);
    expect(ramos.at(-1)!.cents).toBe(100);
    expect(ramos.reduce((s, r) => s + r.parte, 0)).toBeCloseTo(1);
  });

  it("mês sem gasto: sem ramos", () => {
    expect(montarRamos([{ nome: "A", cor: "#111111", cents: 0 }]).ramos).toEqual([]);
  });
});

describe("tinta sobre a cor da categoria", () => {
  it("escura nas cores claras, branca nas escuras", () => {
    expect(tintaSobre("#F0A44A")).toBe("#08090c");
    expect(tintaSobre("#5FD3A6")).toBe("#08090c");
    expect(tintaSobre("#3d45bd")).toBe("#ffffff");
    expect(tintaSobre("não é cor")).toBe("#08090c");
  });
});
