import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { usdBrl } = await import("@/lib/fx");

/**
 * A cotacao do dolar para o gasto de IA em reais.
 *
 * O que guarda: a PTAX (oficial) vem primeiro, com a data no formato que o
 * Banco Central pede e a ULTIMA cotacao do periodo; sem ela, a AwesomeAPI;
 * sem nenhuma, `null` - nunca um numero inventado; e valor absurdo nao passa.
 */

const AGORA = new Date("2026-09-27T15:00:00Z"); // domingo: sem PTAX no dia

function rede(respostas: Record<string, unknown | "falha">) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    const chave = Object.keys(respostas).find((k) => url.includes(k));
    const r = chave ? respostas[chave] : "falha";
    if (r === "falha") throw new Error("rede");
    return new Response(JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

describe("usdBrl", () => {
  it("PTAX: a última cotação de venda do período, com a data dela", async () => {
    const { urls, fetchImpl } = rede({
      "olinda.bcb.gov.br": {
        value: [
          { cotacaoCompra: 5.3, cotacaoVenda: 5.31, dataHoraCotacao: "2026-09-24 13:03:00.000" },
          { cotacaoCompra: 5.34, cotacaoVenda: 5.35, dataHoraCotacao: "2026-09-25 13:04:00.000" },
        ],
      },
    });
    expect(await usdBrl(AGORA, fetchImpl)).toEqual({ rate: 5.35, date: "2026-09-25", source: "PTAX" });
    // Periodo de dez dias ate hoje, em MM-DD-AAAA.
    expect(urls[0]).toContain("@dataInicial='09-17-2026'");
    expect(urls[0]).toContain("@dataFinalCotacao='09-27-2026'");
    expect(urls).toHaveLength(1);
  });

  it("sem PTAX, a AwesomeAPI (venda)", async () => {
    const { fetchImpl } = rede({
      "olinda.bcb.gov.br": "falha",
      awesomeapi: { USDBRL: { bid: "5.40", ask: "5.41", create_date: "2026-09-27 11:00:00" } },
    });
    expect(await usdBrl(AGORA, fetchImpl)).toEqual({ rate: 5.41, date: "2026-09-27", source: "AwesomeAPI" });
  });

  it("PTAX vazia (feriado longo) também cai na AwesomeAPI", async () => {
    const { fetchImpl } = rede({
      "olinda.bcb.gov.br": { value: [] },
      awesomeapi: { USDBRL: { ask: "5.2" } },
    });
    expect((await usdBrl(AGORA, fetchImpl))?.source).toBe("AwesomeAPI");
  });

  it("nenhuma responde, ou responde absurdo: null", async () => {
    expect(await usdBrl(AGORA, rede({}).fetchImpl)).toBeNull();
    const { fetchImpl } = rede({
      "olinda.bcb.gov.br": { value: [{ cotacaoVenda: 0, dataHoraCotacao: "x" }] },
      awesomeapi: { USDBRL: { ask: "abc" } },
    });
    expect(await usdBrl(AGORA, fetchImpl)).toBeNull();
  });
});
