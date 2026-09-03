/**
 * Dinheiro no Fluxo.
 *
 * Duas decisoes que valem o comentario:
 *
 * 1. Toda aritmetica acontece em CENTAVOS inteiros. Somar `0.1 + 0.2` em
 *    ponto flutuante da `0.30000000000000004`; numa fatura com centenas de
 *    linhas isso vira divergencia de centavos contra o total impresso pelo
 *    banco - exatamente o numero que a secao 6 manda comparar.
 *
 * 2. `parseAmount` devolve `null` quando nao consegue interpretar, nunca `0`.
 *    Zero e um valor legitimo; usa-lo como sinal de erro faz a importacao
 *    engolir linhas quebradas em silencio, contra a regra da secao 6
 *    ("nunca importar silenciosamente dados incompletos").
 */

export type Cents = number;

/** Converte reais para centavos inteiros, arredondando meio para cima. */
export function toCents(value: number): Cents {
  return Math.round((value + Number.EPSILON) * 100);
}

/** Converte centavos inteiros de volta para reais. */
export function fromCents(cents: Cents): number {
  return cents / 100;
}

/**
 * Interpreta um valor monetario vindo de CSV, XLSX ou PDF brasileiro.
 *
 * Aceita: "1.023,73"  "-32,90"  "R$ 1.234,56"  "(32,90)"  "1234.56"  "1.023"
 * Devolve `null` para entrada vazia ou nao numerica.
 */
export function parseAmount(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }

  let raw = String(input ?? "").trim();
  if (raw === "") return null;

  // Notacao contabil: (32,90) significa -32,90.
  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1);
  }

  raw = raw.replace(/R\$/gi, "").replace(/\s| /g, "");

  // O sinal pode vir antes ou depois do numero ("32,90-").
  if (raw.startsWith("-") || raw.endsWith("-")) {
    negative = !negative;
    raw = raw.replace(/-/g, "");
  }
  raw = raw.replace(/^\+/, "");

  if (!/^[\d.,]+$/.test(raw) || !/\d/.test(raw)) return null;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // Ambos presentes: o que aparece por ultimo e o separador decimal.
    normalized =
      lastComma > lastDot
        ? raw.replace(/\./g, "").replace(",", ".") // 1.023,73 (pt-BR)
        : raw.replace(/,/g, ""); //                   1,023.73 (en-US)
  } else if (lastComma >= 0) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    // So pontos. "1.023" e milhar; "32.90" e decimal. O desempate e o
    // tamanho do ultimo grupo: exatamente 3 digitos = separador de milhar.
    const groups = raw.split(".");
    const last = groups[groups.length - 1] ?? "";
    const isThousands = groups.length > 1 && last.length === 3;
    normalized = isThousands ? groups.join("") : raw.replace(/\.(?=.*\.)/g, "");
  } else {
    normalized = raw;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  return negative ? -value : value;
}

/** Igual a `parseAmount`, mas ja devolve centavos inteiros. */
export function parseAmountCents(input: unknown): Cents | null {
  const value = parseAmount(input);
  return value === null ? null : toCents(value);
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const BRL_COMPACT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

/** "R$ 1.234,56" a partir de reais. */
export function formatBRL(value: number): string {
  return BRL.format(value);
}

/** "R$ 1.234,56" a partir de centavos. */
export function formatCents(cents: Cents): string {
  return BRL.format(fromCents(cents));
}

/** "R$ 1.235" - para KPIs onde os centavos so poluem. */
export function formatCentsCompact(cents: Cents): string {
  return BRL_COMPACT.format(fromCents(cents));
}
