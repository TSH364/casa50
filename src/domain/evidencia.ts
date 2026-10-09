import type { Cents } from "@/lib/money";
import type { InsightMedida } from "./insights";
import { monthShortLabel } from "./month";

/**
 * A evidencia da Leitura da IA, lida de volta para virar desenho.
 *
 * Os fatos que a IA cita sao frases montadas pelo proprio app em
 * `buildFacts` ("R$ 7.977,56 em 12 lançamento(s), 50% do gasto; média
 * anterior R$ 236,93, ..."). Na tela, essa frase inteira num corpo pequeno
 * era um bloco cinza que ninguem lia. Lida de volta, ela vira barra (o mes
 * contra a media, o gasto contra o limite), parte do todo ou valor de loja.
 *
 * Ler em vez de guardar estruturado: as analises ja salvas no banco tem so o
 * texto, e assim elas tambem ganham o desenho. Formato que nao for
 * reconhecido cai em texto - nunca some nada.
 */
export type EvidenciaLida =
  | {
      tipo: "comparacao";
      titulo: string;
      medida: InsightMedida;
      /** A diferenca ja escrita no fato ("+3267%", "121% do limite"). */
      diferenca: string | null;
      notas: string[];
    }
  | { tipo: "valor"; titulo: string; cents: Cents; notas: string[] }
  | { tipo: "parte"; titulo: string; cents: Cents | null; pct: number; notas: string[] }
  | { tipo: "texto"; titulo: string; linhas: string[] };

const DINHEIRO = /([+\-−]?)R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2})/;
const DINHEIRO_G = new RegExp(DINHEIRO.source, "g");

function centavos(m: RegExpMatchArray | null): Cents | null {
  if (!m) return null;
  const n = Number(m[2]!.replace(/\./g, "").replace(",", ""));
  return m[1] === "-" || m[1] === "−" ? -n : n;
}

/** "12 lançamento(s)" -> "12 lançamentos"; "1 compra(s)" -> "1 compra". */
export function plural(texto: string): string {
  return texto.replace(/(\d+)\s+(\p{L}+)\(s\)/gu, (_, n: string, palavra: string) =>
    Number(n) === 1 ? `${n} ${palavra}` : `${n} ${palavra}s`,
  );
}

function valores(texto: string): Cents[] {
  return [...texto.matchAll(DINHEIRO_G)].map((m) => centavos(m)!);
}

export function lerEvidencia(label: string, value: string): EvidenciaLida {
  const v = plural(value.trim());

  // Categoria X no mes: com media anterior vira comparacao.
  const categoria = label.match(/^Categoria (.+) no mês$/);
  if (categoria) {
    const nome = categoria[1]!;
    const [parteMes, parteMedia] = v.split("; ");
    const atual = centavos(parteMes!.match(DINHEIRO));
    const notas = (parteMes ?? "")
      .replace(DINHEIRO, "")
      .replace(/^\s*em\s*/, "")
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    // O primeiro valor depois do ";" e a media anterior.
    const media = parteMedia ? centavos(parteMedia.match(DINHEIRO)) : null;
    if (atual !== null && media !== null) {
      return {
        tipo: "comparacao",
        titulo: nome,
        medida: { atualCents: atual, atualRotulo: "No mês", referenciaCents: media, referenciaRotulo: "média" },
        diferenca: parteMedia!.match(/\(([+\-−]?\d+%)\)/)?.[1] ?? null,
        notas,
      };
    }
    const pct = (parteMes ?? "").match(/(\d+)% do gasto/);
    if (atual !== null && pct) {
      return { tipo: "parte", titulo: nome, cents: atual, pct: Number(pct[1]), notas: notas.filter((n) => !n.includes("%")) };
    }
  }

  // Orcamento: "R$ X de R$ L (P%)".
  const orcamento = label.match(/^Orçamento de (.+)$/);
  if (orcamento) {
    const [gasto, limite] = valores(v);
    const pct = v.match(/\((\d+)%\)/)?.[1];
    if (gasto !== undefined && limite !== undefined) {
      return {
        tipo: "comparacao",
        titulo: `Orçamento de ${orcamento[1]}`,
        medida: { atualCents: gasto, atualRotulo: "Gasto", referenciaCents: limite, referenciaRotulo: "limite" },
        diferenca: pct ? `${pct}% do limite` : null,
        notas: [],
      };
    }
  }

  // Conta fixa que veio diferente: "cadastrada R$ A, cobrada R$ B, diferença ...".
  const conta = label.match(/^Conta fixa (.+)$/);
  if (conta && /cadastrada/.test(v) && /cobrada/.test(v)) {
    const [cadastrada, cobrada] = valores(v);
    if (cadastrada !== undefined && cobrada !== undefined) {
      return {
        tipo: "comparacao",
        titulo: conta[1]!,
        medida: { atualCents: cobrada, atualRotulo: "Cobrada", referenciaCents: cadastrada, referenciaRotulo: "cadastrada" },
        diferenca: v.match(/diferença\s+([+\-−]?R\$\s?[\d.,]+)/)?.[1] ?? null,
        notas: [],
      };
    }
  }

  // Loja: "R$ X em N compras".
  const loja = label.match(/^Loja (?:nova no mês \(não aparece nos meses anteriores\): )?(.+)$/);
  if (loja) {
    const cents = centavos(v.match(DINHEIRO));
    if (cents !== null) {
      const notas = [v.replace(DINHEIRO, "").replace(/^\s*em\s*/, "").trim()].filter(Boolean);
      if (label.startsWith("Loja nova")) notas.unshift("loja nova");
      return { tipo: "valor", titulo: loja[1]!, cents, notas };
    }
  }

  // Parte do todo: "R$ X (P%)", "N compras, R$ X (P% do gasto)".
  const parte = v.match(/^(?:(.+?),\s*)?(R\$\s?[\d.,]+)\s*\((\d+)%(?: do gasto)?\)$/);
  if (parte) {
    return {
      tipo: "parte",
      titulo: label,
      cents: centavos(parte[2]!.match(DINHEIRO)),
      pct: Number(parte[3]),
      notas: parte[1] ? [parte[1]] : [],
    };
  }

  // Um valor so.
  const unico = v.match(/^R\$\s?[\d.,]+$/);
  if (unico) return { tipo: "valor", titulo: label, cents: centavos(v.match(DINHEIRO))!, notas: [] };

  return {
    tipo: "texto",
    titulo: label.replace(/^Observação do app:\s*/, ""),
    // "última em 2026-11" -> "última em nov/26".
    linhas: v
      .split(/;\s*/)
      .filter(Boolean)
      .map((l) => l.replace(/(\d{4})-(\d{2})\b/g, (_, a: string, m: string) => `${monthShortLabel(`${a}-${m}`)}/${a.slice(2)}`)),
  };
}
