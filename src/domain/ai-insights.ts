import { z } from "zod";
import { formatCents, type Cents } from "@/lib/money";
import { addMonths, monthLabel, monthRange } from "./month";
import {
  committedInstallments,
  projectMonthEnd,
  spendingCents,
  summarizeMonth,
  totalsByCategory,
} from "./finance";
import { merchantLabel } from "./merchants";
import type { RecurrenceMatch } from "./forecast";
import type { Insight, InsightTone } from "./insights";
import type { Budget, Category, MonthKey, Transaction } from "./types";

/**
 * A analise do mes feita por IA (secao 14, com IA).
 *
 * A regra da secao 14 continua valendo: nenhuma conclusao sem os numeros que
 * a sustentam. Com IA ela fica mais dificil de cumprir, porque modelo de
 * linguagem erra conta e inventa numero com a mesma confianca com que acerta.
 * Por isso o desenho e em tres passos, e so o do meio e da IA:
 *
 *   1. O APP calcula os FATOS - uma lista numerada, cada um com rotulo e
 *      valor ja formatado ("F3: Mercado no mes = R$ 1.234,56 ...").
 *   2. A IA escreve as analises, citando os fatos pelo numero. O papel dela e
 *      ligar fatos, achar padrao e sugerir - nao fazer conta.
 *   3. O APP confere: todo numero no texto tem de estar num fato. Analise com
 *      numero que nao veio dos fatos e DESCARTADA, e a tela diz quantas foram.
 *
 * A evidencia que a tela mostra embaixo de cada analise sai dos fatos, nunca
 * do texto da IA.
 */

export interface Fact {
  id: string;
  label: string;
  value: string;
}

export interface Person {
  id: string;
  name: string;
}

export interface FactInput {
  month: MonthKey;
  /** Ate 6 meses antes do mes e 3 depois (as parcelas futuras). */
  transactions: readonly Transaction[];
  categories: readonly Category[];
  budgets: readonly Budget[];
  recurrenceMatches: readonly RecurrenceMatch[];
  members: readonly Person[];
  /** As observacoes que o app ja fez sozinho, para a IA ir alem delas. */
  insights: readonly Insight[];
  /** Presente so quando o mes ainda esta correndo: liga a projecao. */
  now?: Date;
}

const MAX_FATOS = 60;

const brl = (c: Cents) => formatCents(c);
const pct = (r: number) => `${Math.round(r * 100)}%`;
const sinal = (c: Cents) => (c > 0 ? `+${brl(c)}` : c < 0 ? `-${brl(-c)}` : brl(0));
const media = (xs: readonly number[]) => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));

/** Despesas realizadas do mes, fora as escondidas. */
function gastosDoMes(transactions: readonly Transaction[], month: MonthKey): Transaction[] {
  return transactions.filter(
    (t) =>
      t.invoiceMonth === month &&
      t.type === "expense" &&
      !t.isHidden &&
      (t.status === "confirmed" || t.status === "divergent"),
  );
}

export function buildFacts(input: FactInput): Fact[] {
  const { month, transactions, categories } = input;
  const fatos: Omit<Fact, "id">[] = [];
  const add = (label: string, value: string) => fatos.push({ label, value });
  const nomeCategoria = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Sem categoria";
  const rotuloMes = monthLabel(month);

  // Meses anteriores COM dado: mes vazio no comeco do uso do app nao e mes
  // sem gasto, e contar como zero derrubaria a media.
  const anteriores = monthRange(addMonths(month, -6), addMonths(month, -1)).filter((m) =>
    transactions.some((t) => t.invoiceMonth === m),
  );

  // ---- o mes inteiro
  const atual = summarizeMonth(transactions, month);
  add(`Gasto de ${rotuloMes}`, brl(atual.spentCents));
  if (anteriores.length > 0) {
    const m = media(anteriores.map((x) => summarizeMonth(transactions, x).spentCents));
    add(`Média de gasto dos ${anteriores.length} meses anteriores`, brl(m));
    if (m > 0) {
      add(`Diferença de ${rotuloMes} para a média`, `${sinal(atual.spentCents - m)} (${pct((atual.spentCents - m) / m)})`);
    }
  }
  if (atual.incomeCents > 0) {
    add("Receitas do mês", brl(atual.incomeCents));
    add("Saldo do mês (receitas menos gastos)", sinal(atual.balanceCents));
  }
  if (input.now) {
    add("Projeção do gasto até o fim do mês, no ritmo atual", brl(projectMonthEnd(atual.spentCents, month, input.now)));
  }
  if (atual.installmentCents > 0 && atual.spentCents > 0) {
    add("Parte do gasto do mês que veio de parcelas", `${brl(atual.installmentCents)} (${pct(atual.installmentCents / atual.spentCents)})`);
  }

  // ---- categorias: o mes contra a media de cada uma
  const historico = new Map<string | null, number[]>();
  for (const m of anteriores) {
    const totais = new Map(totalsByCategory(transactions, m).map((t) => [t.categoryId, t.totalCents]));
    for (const c of new Set([...historico.keys(), ...totais.keys()])) {
      historico.set(c, [...(historico.get(c) ?? []), totais.get(c) ?? 0]);
    }
  }
  const mediaDe = (id: string | null) => {
    const h = historico.get(id) ?? [];
    // Categoria que nao apareceu num mes anterior conta zero naquele mes.
    return h.length === 0 ? null : media([...h, ...Array(anteriores.length - h.length).fill(0)]);
  };
  const doMes = totalsByCategory(transactions, month);
  for (const c of doMes.slice(0, 10)) {
    const m = mediaDe(c.categoryId);
    const partes = [`${brl(c.totalCents)} em ${c.count} lançamento(s), ${pct(c.share)} do gasto`];
    if (m !== null && anteriores.length >= 2) partes.push(`média anterior ${brl(m)}, diferença ${sinal(c.totalCents - m)}`);
    add(`Categoria ${nomeCategoria(c.categoryId)} no mês`, partes.join("; "));
  }
  // O que costumava pesar e sumiu tambem e noticia.
  const noMes = new Set(doMes.map((c) => c.categoryId));
  const sumiram = [...historico.keys()]
    .filter((id) => !noMes.has(id))
    .map((id) => ({ id, m: mediaDe(id) ?? 0 }))
    .filter((x) => x.m >= 10_000)
    .sort((a, b) => b.m - a.m)
    .slice(0, 3);
  for (const s of sumiram) {
    add(`Categoria ${nomeCategoria(s.id)} sem gasto no mês`, `média anterior ${brl(s.m)}`);
  }

  // ---- lojas
  const gastos = gastosDoMes(transactions, month);
  const porLoja = new Map<string, { cents: Cents; n: number }>();
  for (const t of gastos) {
    const k = merchantLabel(t);
    const v = porLoja.get(k) ?? { cents: 0, n: 0 };
    porLoja.set(k, { cents: v.cents + spendingCents(t), n: v.n + 1 });
  }
  const lojas = [...porLoja.entries()].sort((a, b) => b[1].cents - a[1].cents);
  for (const [nome, v] of lojas.slice(0, 8)) {
    add(`Loja ${nome}`, `${brl(v.cents)} em ${v.n} compra(s)`);
  }
  const vistasAntes = new Set(
    transactions.filter((t) => anteriores.includes(t.invoiceMonth)).map((t) => merchantLabel(t)),
  );
  if (anteriores.length >= 2) {
    const novas = lojas.filter(([nome, v]) => !vistasAntes.has(nome) && v.cents >= 10_000).slice(0, 5);
    for (const [nome, v] of novas) add(`Loja nova no mês (não aparece nos meses anteriores): ${nome}`, brl(v.cents));
  }

  // ---- como o dinheiro sai
  if (atual.spentCents > 0) {
    const pequenos = gastos.filter((t) => spendingCents(t) > 0 && spendingCents(t) < 5_000);
    if (pequenos.length >= 5) {
      const soma = pequenos.reduce((s, t) => s + spendingCents(t), 0);
      add("Compras abaixo de R$ 50 no mês", `${pequenos.length} compras, ${brl(soma)} (${pct(soma / atual.spentCents)} do gasto)`);
    }
    const fds = gastos
      .filter((t) => [0, 6].includes(new Date(`${t.date}T12:00:00Z`).getUTCDay()))
      .reduce((s, t) => s + spendingCents(t), 0);
    if (fds > 0) add("Gasto em sábados e domingos", `${brl(fds)} (${pct(fds / atual.spentCents)} do gasto)`);
  }

  // ---- quem gastou
  if (input.members.length > 1 && atual.spentCents > 0) {
    const porPessoa = new Map<string, Cents>();
    for (const t of gastos) {
      const quem = t.isJoint
        ? input.members.length === 2
          ? "os dois"
          : "todos"
        : (input.members.find((m) => m.id === (t.memberId ?? t.cardOwnerId))?.name ?? "sem pessoa definida");
      porPessoa.set(quem, (porPessoa.get(quem) ?? 0) + spendingCents(t));
    }
    for (const [quem, c] of [...porPessoa.entries()].sort((a, b) => b[1] - a[1])) {
      if (c > 0) add(`Gasto por pessoa: ${quem}`, `${brl(c)} (${pct(c / atual.spentCents)})`);
    }
  }

  // ---- orcamentos, contas fixas, parcelas
  for (const b of input.budgets) {
    const limite = Math.round(b.limitAmount * 100);
    const gasto = doMes.find((c) => c.categoryId === b.categoryId)?.totalCents ?? 0;
    if (limite > 0) add(`Orçamento de ${nomeCategoria(b.categoryId)}`, `${brl(gasto)} de ${brl(limite)} (${pct(gasto / limite)})`);
  }
  for (const r of input.recurrenceMatches) {
    if (r.status === "divergent" && r.actualCents !== null) {
      add(`Conta fixa ${r.recurrence.description}`, `cadastrada ${brl(r.expectedCents)}, cobrada ${brl(r.actualCents)}, diferença ${sinal(r.differenceCents)}`);
    } else if (r.status === "missing") {
      add(`Conta fixa ${r.recurrence.description} ainda não apareceu no mês`, `esperada ${brl(r.expectedCents)}`);
    }
  }
  for (const c of committedInstallments(transactions, month, 3)) {
    if (c.totalCents > 0) add(`Parcelas já assumidas para ${monthLabel(c.month)}`, `${brl(c.totalCents)} em ${c.count} parcela(s)`);
  }

  // ---- o que o app ja observou
  for (const i of input.insights.slice(0, 6)) {
    add(`Observação do app: ${i.title}`, i.evidence.map((e) => `${e.label} ${e.value}`).join("; "));
  }

  return fatos.slice(0, MAX_FATOS).map((f, i) => ({ id: `F${i + 1}`, ...f }));
}

// ---------------------------------------------------------------------------
// O pedido
// ---------------------------------------------------------------------------

export const ANALYSIS_INSTRUCTIONS = `Você é o analista financeiro de uma casa brasileira. Recebe FATOS numerados sobre um mês, calculados pelo app, e escreve de 3 a 5 análises curtas em português do Brasil.

O que vale uma análise: ligar fatos entre si (uma categoria que subiu e a loja que explica), um padrão (pequenas compras, fim de semana, uma pessoa concentrando um tipo de gasto), um risco (orçamento perto do fim, parcelas pesando nos próximos meses, conta fixa que subiu), ou uma oportunidade concreta de economia. Não repita uma "Observação do app" sem acrescentar algo novo.

REGRAS DE NÚMERO, obrigatórias:
- Use só números que aparecem nos fatos, escritos como estão (ex.: "R$ 1.234,56", "32%").
- Não faça conta nova: não some, não subtraia, não calcule porcentagem. Se precisar de uma diferença, use a que já está num fato.
- Cada análise cita de 1 a 4 fatos pelo id (ex.: ["F3","F12"]), e todo número do texto tem de estar num fato citado.
- Datas, dias e anos: não escreva.

Tom: direto, sem julgamento moral, sem "vocês deveriam se envergonhar". A sugestão é opcional, prática e sem número novo.

Responda SÓ com JSON, sem texto antes ou depois:
{"analises":[{"titulo":"até 80 caracteres","texto":"1 a 3 frases","tom":"atencao|positivo|neutro","fatos":["F1"],"sugestao":"opcional"}]}`;

export function factsPrompt(month: MonthKey, facts: readonly Fact[]): string {
  return [`Mês analisado: ${monthLabel(month)}.`, "", "FATOS:", ...facts.map((f) => `${f.id}: ${f.label} = ${f.value}`)].join("\n");
}

// ---------------------------------------------------------------------------
// A conferencia
// ---------------------------------------------------------------------------

export interface AiAnalysis {
  title: string;
  text: string;
  tone: InsightTone;
  suggestion: string | null;
  evidence: { label: string; value: string }[];
}

export interface CheckedAnalyses {
  items: AiAnalysis[];
  /** Quantas a IA escreveu e a conferencia jogou fora. */
  dropped: number;
}

/**
 * Os numeros de um texto, em pt-BR: "R$ 1.234,56" vira 1234.56, "32%" vira
 * 32, "1,2 mil" vira 1200.
 *
 * Fica de fora o que nao e valor: inteiros ate 12 (contagem de meses, de
 * compras) e anos soltos. O risco que a conferencia combate e VALOR
 * inventado, e esses nao sao.
 */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(\s*mil\b)?/gi)) {
    const inteiro = m[1]!;
    const bruto = Number(`${inteiro.replace(/\./g, "")}.${m[2] ?? "0"}`) * (m[3] ? 1000 : 1);
    if (!Number.isFinite(bruto)) continue;
    const simples = !inteiro.includes(".") && m[2] === undefined && !m[3];
    if (simples && bruto <= 12) continue;
    if (simples && bruto >= 1990 && bruto <= 2100) continue;
    out.push(bruto);
  }
  return out;
}

/** Arredondar e permitido ("R$ 1.235" por R$ 1.234,56; "1,2 mil"); inventar, nao. */
function bate(n: number, f: number): boolean {
  return Math.abs(n - f) <= Math.max(1, Math.abs(f) * 0.03);
}

const TOM: Record<string, InsightTone> = { atencao: "attention", positivo: "positive", neutro: "neutral" };

const respostaSchema = z.object({
  analises: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(120),
        texto: z.string().trim().min(1).max(600),
        tom: z.string().optional(),
        fatos: z.array(z.string()).min(1).max(6),
        sugestao: z.string().trim().max(300).nullish(),
      }),
    )
    .max(8),
});

/** Tira cerca de codigo e texto em volta: o JSON e do primeiro "{" ao ultimo "}". */
function jsonDe(raw: string): unknown {
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(raw.slice(i, j + 1));
  } catch {
    return null;
  }
}

export function checkAnalyses(raw: string, facts: readonly Fact[]): CheckedAnalyses | null {
  const parsed = respostaSchema.safeParse(jsonDe(raw));
  if (!parsed.success) return null;

  const porId = new Map(facts.map((f) => [f.id.toUpperCase(), f]));
  const numerosDe = new Map(facts.map((f) => [f.id, numbersIn(`${f.label} ${f.value}`)]));
  const items: AiAnalysis[] = [];
  let dropped = 0;

  for (const a of parsed.data.analises.slice(0, 5)) {
    const citados = [...new Set(a.fatos.map((id) => porId.get(id.trim().toUpperCase())).filter((f): f is Fact => !!f))];
    const numeros = numbersIn(`${a.titulo} ${a.texto} ${a.sugestao ?? ""}`);
    if (citados.length === 0) {
      dropped += 1;
      continue;
    }
    // Numero achado num fato que a IA esqueceu de citar: vale, e o fato entra
    // na evidencia - quem le precisa ver de onde ele veio.
    let ok = true;
    for (const n of numeros) {
      if (citados.some((f) => numerosDe.get(f.id)!.some((x) => bate(n, x)))) continue;
      const outro = facts.find((f) => numerosDe.get(f.id)!.some((x) => bate(n, x)));
      if (outro && citados.length < 6) citados.push(outro);
      else {
        ok = false;
        break;
      }
    }
    if (!ok) {
      dropped += 1;
      continue;
    }
    items.push({
      title: a.titulo,
      text: a.texto,
      tone: TOM[(a.tom ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()] ?? "neutral",
      suggestion: a.sugestao?.trim() || null,
      evidence: citados.map((f) => ({ label: f.label, value: f.value })),
    });
  }
  dropped += Math.max(0, parsed.data.analises.length - 5);
  return { items, dropped };
}

/** O que fica guardado em `ai_insights.content`, lido de volta com a mesma forma. */
export const savedAnalysisSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      text: z.string(),
      tone: z.enum(["positive", "neutral", "attention", "danger"]),
      suggestion: z.string().nullable(),
      evidence: z.array(z.object({ label: z.string(), value: z.string() })),
    }),
  ),
  dropped: z.number().int().min(0),
});
