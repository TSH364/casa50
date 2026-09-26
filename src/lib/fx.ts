import "server-only";

/**
 * A cotacao do dolar, para mostrar em reais o gasto de IA (secao 15).
 *
 * O OpenRouter cobra em dolar; a casa pensa em reais. Duas fontes, nesta
 * ordem:
 *
 *   1. PTAX do Banco Central - a cotacao oficial. Venda, do ultimo dia util
 *      (fim de semana e feriado nao tem PTAX, por isso a busca e por periodo).
 *   2. AwesomeAPI - se o Banco Central nao responder.
 *
 * Sem nenhuma das duas, `null`: a tela mostra em dolar e diz por que, em vez
 * de converter por um numero inventado.
 *
 * Guardada por 6 horas (cache do `fetch` do Next): a cotacao muda ao longo do
 * dia, mas o gasto de IA e de centavos - buscar a cada abertura da tela seria
 * trabalho sem diferenca que se veja.
 */

export interface UsdBrl {
  /** Reais por dolar. */
  rate: number;
  /** AAAA-MM-DD da cotacao. */
  date: string;
  source: "PTAX" | "AwesomeAPI";
}

const SEIS_HORAS = 6 * 60 * 60;
const TIMEOUT_MS = 5_000;

type FetchLike = typeof fetch;

async function pegarJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, {
      signal: controle.signal,
      next: { revalidate: SEIS_HORAS },
    } as RequestInit);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

/** MM-DD-AAAA, o formato que a API do Banco Central pede. */
function dataBcb(d: Date): string {
  const [a, m, dia] = d.toISOString().slice(0, 10).split("-");
  return `${m}-${dia}-${a}`;
}

function valida(n: unknown): number | null {
  const v = typeof n === "number" ? n : Number(n);
  // Faixa larga de proposito: so descarta o absurdo (zero, texto, 500).
  return Number.isFinite(v) && v > 0.5 && v < 50 ? v : null;
}

export async function ptax(now: Date, fetchImpl: FetchLike = fetch): Promise<UsdBrl | null> {
  // Dez dias para tras cobre qualquer feriado prolongado.
  const inicio = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@dataInicial='${dataBcb(inicio)}'&@dataFinalCotacao='${dataBcb(now)}'&$format=json`;
  const json = (await pegarJson(url, fetchImpl)) as {
    value?: { cotacaoVenda?: unknown; dataHoraCotacao?: unknown }[];
  } | null;
  const ultima = json?.value?.at(-1);
  const rate = valida(ultima?.cotacaoVenda);
  if (!ultima || rate === null) return null;
  return { rate, date: String(ultima.dataHoraCotacao ?? "").slice(0, 10), source: "PTAX" };
}

export async function awesome(fetchImpl: FetchLike = fetch): Promise<UsdBrl | null> {
  const json = (await pegarJson("https://economia.awesomeapi.com.br/json/last/USD-BRL", fetchImpl)) as {
    USDBRL?: { ask?: unknown; create_date?: unknown };
  } | null;
  const rate = valida(json?.USDBRL?.ask);
  if (rate === null) return null;
  return { rate, date: String(json?.USDBRL?.create_date ?? "").slice(0, 10), source: "AwesomeAPI" };
}

export async function usdBrl(now: Date = new Date(), fetchImpl: FetchLike = fetch): Promise<UsdBrl | null> {
  return (await ptax(now, fetchImpl)) ?? (await awesome(fetchImpl));
}
