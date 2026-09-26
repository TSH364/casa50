import "server-only";
import {
  listBudgets,
  listGoals,
  listProjectItems,
  listProjects,
  listTransactions,
} from "@/data/queries";
import {
  committedInstallments,
  spendingCents,
  summarizeMonth,
  totalsByCategory,
} from "@/domain/finance";
import { merchantLabel } from "@/domain/merchants";
import { addMonths, monthLabel, monthRange } from "@/domain/month";
import { projectSummary } from "@/domain/project";
import {
  TOOL_ARGS,
  capToolOutput,
  findCategory,
  findMember,
  firstName,
  isToolName,
  resolveRange,
} from "@/domain/chat";
import { refOf, refPrefix } from "@/domain/chat";
import type { Proposal, Range, ToolName } from "@/domain/chat";
import { normalizeMerchant } from "@/importers/detect";
import { formatCents, toCents } from "@/lib/money";
import type { Category, MonthKey, Transaction } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

/**
 * O servidor executando o que a IA pediu (secao 16).
 *
 * Cada ferramenta le com as funcoes de sempre (`listTransactions`, os totais
 * do dominio), com a sessao de quem perguntou - entao o RLS vale, e os
 * numeros sao os MESMOS das telas. Nenhuma calcula por conta propria o que o
 * dominio ja calcula: um total da conversa que nao bate com o do Inicio e
 * pior que nenhum.
 *
 * A saida e texto curto, uma linha por fato. Mais barato que JSON para o
 * modelo ler, e o valor ja vai formatado - modelo pequeno erra conta de
 * centavos, e aqui nao precisa fazer nenhuma.
 */

export interface ToolContext {
  houseId: string;
  today: MonthKey;
  members: MemberSummary[];
  categories: Category[];
  excludeCategoryIds: string[];
  /**
   * Onde as ferramentas de PROPOR deixam o que propuseram. Nada aqui e
   * gravado: a lista volta para a tela como cartoes, e so `applyProposal`,
   * depois do toque, grava.
   */
  proposals: Proposal[];
  /** Hoje, AAAA-MM-DD, no fuso da casa - a data padrao de um lancamento. */
  todayIso: string;
}

const R = (cents: number) => formatCents(cents);

function nomeCategoria(ctx: ToolContext, id: string | null): string {
  if (id === null) return "Sem categoria";
  return ctx.categories.find((c) => c.id === id)?.name ?? "Categoria removida";
}

function nomePessoa(ctx: ToolContext, t: Transaction): string {
  if (t.isJoint) return ctx.members.length === 2 ? "os dois" : "todos";
  const id = t.memberId ?? t.cardOwnerId ?? null;
  const m = ctx.members.find((x) => x.userId === id);
  return m ? firstName(m.fullName) : "sem pessoa";
}

type Filtros = {
  range: Range;
  memberId: string | null;
  category: Category | null;
  notes: string[];
};

/** Resolve pessoa, categoria e meses; devolve o erro em frase quando nao da. */
function filtros(
  ctx: ToolContext,
  a: { mes?: string; de?: string; ate?: string; pessoa?: string; categoria?: string },
): Filtros | string {
  const r = resolveRange(a, ctx.today);
  if ("error" in r) return r.error;
  const notes = r.note ? [r.note] : [];

  let memberId: string | null = null;
  if (a.pessoa) {
    const m = findMember(a.pessoa, ctx.members);
    if (!m) {
      return `Não achei a pessoa "${a.pessoa}". Pessoas da casa: ${ctx.members.map((x) => firstName(x.fullName)).join(", ")}.`;
    }
    memberId = m.userId;
  }

  let category: Category | null = null;
  if (a.categoria) {
    category = findCategory(a.categoria, ctx.categories);
    if (!category) return `Não achei a categoria "${a.categoria}".`;
    if (ctx.excludeCategoryIds.includes(category.parentId ?? category.id)) {
      notes.push(`${category.name} fica fora dos totais da casa; os números abaixo a incluem porque foi pedida.`);
    }
  }
  return { range: r.range, memberId, category, notes };
}

/** A categoria pedida vale para a mae e para a sub. */
function naCategoria(t: Transaction, c: Category | null): boolean {
  if (c === null) return true;
  return c.parentId === null ? t.categoryId === c.id : t.subcategoryId === c.id;
}

async function lerLancamentos(ctx: ToolContext, f: Filtros): Promise<Transaction[]> {
  // Categoria pedida explicitamente entra mesmo se estiver fora dos totais.
  const pedida = f.category ? (f.category.parentId ?? f.category.id) : null;
  const txs = await listTransactions(ctx.houseId, {
    fromMonth: f.range.from,
    toMonth: f.range.to,
    memberId: f.memberId,
    excludeCategoryIds: ctx.excludeCategoryIds.filter((id) => id !== pedida),
    limit: 5000,
  });
  return txs.filter((t) => naCategoria(t, f.category));
}

function cabecalho(f: Filtros, ctx: ToolContext, titulo: string): string[] {
  const periodo =
    f.range.from === f.range.to
      ? monthLabel(f.range.from)
      : `${monthLabel(f.range.from)} a ${monthLabel(f.range.to)}`;
  const pessoa = f.memberId
    ? ` · ${firstName(ctx.members.find((m) => m.userId === f.memberId)!.fullName)}`
    : "";
  const cat = f.category ? ` · ${f.category.name}` : "";
  return [`${titulo} — ${periodo}${pessoa}${cat}`, ...f.notes];
}

// ---------------------------------------------------------------------------

async function resumoDoMes(ctx: ToolContext, a: { mes?: string; pessoa?: string }): Promise<string> {
  const f = filtros(ctx, { mes: a.mes, pessoa: a.pessoa });
  if (typeof f === "string") return f;
  const mes = f.range.to;
  const anterior = addMonths(mes, -1);
  const txs = await lerLancamentos(ctx, { ...f, range: { from: anterior, to: mes } });

  const opts = { memberId: f.memberId };
  const s = summarizeMonth(txs, mes, opts);
  const p = summarizeMonth(txs, anterior, opts);
  if (s.count === 0 && s.forecastCents === 0) {
    return `${cabecalho(f, ctx, "Resumo")[0]}\nNenhum lançamento neste mês.`;
  }

  const linhas = cabecalho(f, ctx, "Resumo");
  linhas.push(`Gasto: ${R(s.spentCents)} em ${s.count} lançamentos`);
  if (p.spentCents > 0) {
    const dif = s.spentCents - p.spentCents;
    const pct = Math.round((dif / p.spentCents) * 100);
    linhas.push(
      `Mês anterior (${monthLabel(anterior)}): ${R(p.spentCents)} — ${dif >= 0 ? "+" : "−"}${R(Math.abs(dif))} (${pct >= 0 ? "+" : ""}${pct}%)`,
    );
  }
  if (s.incomeCents > 0) linhas.push(`Receitas: ${R(s.incomeCents)} · Saldo: ${R(s.balanceCents)}`);
  if (s.installmentCents > 0) linhas.push(`Parte parcelada: ${R(s.installmentCents)}`);
  if (s.forecastCents > 0) linhas.push(`Ainda previsto (não confirmado): ${R(s.forecastCents)}`);
  linhas.push("Por categoria:");
  for (const c of totalsByCategory(txs, mes, opts).slice(0, 14)) {
    linhas.push(`- ${nomeCategoria(ctx, c.categoryId)}: ${R(c.totalCents)} (${Math.round(c.share * 100)}%, ${c.count}×)`);
  }
  return linhas.join("\n");
}

async function gastosPorCategoria(
  ctx: ToolContext,
  a: { de?: string; ate?: string; categoria?: string; pessoa?: string },
): Promise<string> {
  const f = filtros(ctx, a);
  if (typeof f === "string") return f;
  const txs = await lerLancamentos(ctx, f);
  const meses = monthRange(f.range.from, f.range.to);
  const linhas = cabecalho(f, ctx, "Gasto por mês");

  // Com uma categoria-mae pedida, o detalhe vai para as subcategorias dela;
  // sem categoria, para as categorias-mae.
  const chave = (t: Transaction): string =>
    f.category && f.category.parentId === null
      ? t.subcategoryId
        ? nomeCategoria(ctx, t.subcategoryId)
        : `${f.category.name} (sem subcategoria)`
      : f.category
        ? f.category.name
        : nomeCategoria(ctx, t.categoryId);

  const tabela = new Map<string, Map<MonthKey, number>>();
  const totalMes = new Map<MonthKey, number>();
  for (const m of meses) {
    // O total do mes sai do dominio, o mesmo do Inicio; o detalhe soma os
    // mesmos lancamentos que ele considerou.
    totalMes.set(m, summarizeMonth(txs, m, { memberId: f.memberId }).spentCents);
    for (const t of txs) {
      if (t.invoiceMonth !== m || t.status === "forecast" || t.status === "cancelled" || t.status === "missing") continue;
      const v = spendingCents(t);
      if (v === 0) continue;
      const k = chave(t);
      const linha = tabela.get(k) ?? new Map<MonthKey, number>();
      linha.set(m, (linha.get(m) ?? 0) + v);
      tabela.set(k, linha);
    }
  }

  linhas.push(`Total: ${meses.map((m) => `${m} ${R(totalMes.get(m) ?? 0)}`).join(" | ")}`);
  const media = [...totalMes.values()].reduce((a2, b) => a2 + b, 0) / Math.max(1, meses.length);
  if (meses.length > 1) linhas.push(`Média mensal: ${R(Math.round(media))}`);

  const ordenadas = [...tabela].sort(
    (x, y) => [...y[1].values()].reduce((a2, b) => a2 + b, 0) - [...x[1].values()].reduce((a2, b) => a2 + b, 0),
  );
  for (const [nome, porMes] of ordenadas.slice(0, 16)) {
    const soma = [...porMes.values()].reduce((a2, b) => a2 + b, 0);
    const valores = meses.map((m) => `${m} ${R(porMes.get(m) ?? 0)}`).join(" | ");
    linhas.push(`- ${nome}: ${valores}${meses.length > 1 ? ` · média ${R(Math.round(soma / meses.length))}` : ""}`);
  }
  return linhas.join("\n");
}

async function buscarLancamentos(
  ctx: ToolContext,
  a: { de?: string; ate?: string; categoria?: string; pessoa?: string; texto?: string; ordenar?: "valor" | "data"; limite?: number },
): Promise<string> {
  const f = filtros(ctx, a);
  if (typeof f === "string") return f;
  let txs = await lerLancamentos(ctx, f);
  txs = txs.filter((t) => t.status !== "cancelled" && t.status !== "missing" && !t.isHidden);
  if (a.texto) {
    const alvo = a.texto.toLowerCase();
    txs = txs.filter((t) =>
      [t.description, t.merchantOriginal, t.merchantAlias, t.merchantNormalized].some((v) =>
        v?.toLowerCase().includes(alvo),
      ),
    );
  }
  const ordenar = a.ordenar ?? "valor";
  txs.sort((x, y) =>
    ordenar === "valor" ? toCents(y.amount) - toCents(x.amount) : y.date.localeCompare(x.date),
  );
  const limite = a.limite ?? 15;
  const linhas = cabecalho(f, ctx, `Lançamentos${a.texto ? ` com "${a.texto}"` : ""}`);
  linhas.push(`${txs.length} encontrados${txs.length > limite ? `; mostrando ${limite} (${ordenar === "valor" ? "maiores" : "mais recentes"})` : ""}.`);
  if (txs.length > 0) {
    const soma = txs.reduce((s, t) => s + spendingCents(t), 0);
    linhas.push(`Soma de todos os encontrados: ${R(soma)}`);
  }
  for (const t of txs.slice(0, limite)) {
    const extra = [
      nomeCategoria(ctx, t.categoryId) + (t.subcategoryId ? ` › ${nomeCategoria(ctx, t.subcategoryId)}` : ""),
      nomePessoa(ctx, t),
      t.installment ? `parcela ${t.installment.current}/${t.installment.total}` : null,
      t.type !== "expense" ? t.type : null,
      t.status === "forecast" ? "previsto" : null,
    ].filter(Boolean);
    linhas.push(`- ${refOf(t.id)} · ${t.date} · ${merchantLabel(t)} · ${R(toCents(t.amount))} · ${extra.join(" · ")}`);
  }
  return linhas.join("\n");
}

async function principaisLojas(
  ctx: ToolContext,
  a: { de?: string; ate?: string; categoria?: string; pessoa?: string; limite?: number },
): Promise<string> {
  const f = filtros(ctx, a);
  if (typeof f === "string") return f;
  const txs = await lerLancamentos(ctx, f);
  const porLoja = new Map<string, { cents: number; n: number }>();
  for (const t of txs) {
    if (t.status === "forecast" || t.status === "cancelled" || t.status === "missing") continue;
    const v = spendingCents(t);
    if (v <= 0) continue;
    const k = merchantLabel(t);
    const atual = porLoja.get(k) ?? { cents: 0, n: 0 };
    atual.cents += v;
    atual.n += 1;
    porLoja.set(k, atual);
  }
  const linhas = cabecalho(f, ctx, "Principais lojas");
  const lista = [...porLoja].sort((x, y) => y[1].cents - x[1].cents).slice(0, a.limite ?? 10);
  if (lista.length === 0) linhas.push("Nenhum gasto encontrado.");
  for (const [loja, v] of lista) linhas.push(`- ${loja}: ${R(v.cents)} em ${v.n} compra(s)`);
  return linhas.join("\n");
}

async function parcelasFuturas(ctx: ToolContext): Promise<string> {
  const txs = await listTransactions(ctx.houseId, {
    fromMonth: addMonths(ctx.today, 1),
    toMonth: addMonths(ctx.today, 6),
    excludeCategoryIds: ctx.excludeCategoryIds,
    limit: 5000,
  });
  const meses = committedInstallments(txs, ctx.today, 6);
  const linhas = ["Parcelas já compradas, por mês de fatura:"];
  for (const m of meses) {
    linhas.push(`${monthLabel(m.month)}: ${R(m.totalCents)} (${m.count} parcelas)`);
    for (const t of m.items.slice(0, 6)) {
      linhas.push(`  - ${merchantLabel(t)} ${t.installment!.current}/${t.installment!.total}: ${R(toCents(t.amount))}`);
    }
    if (m.items.length > 6) linhas.push(`  - e mais ${m.items.length - 6}`);
  }
  return linhas.join("\n");
}

async function orcamentosMetasProjetos(ctx: ToolContext, a: { mes?: string }): Promise<string> {
  const r = resolveRange({ mes: a.mes }, ctx.today);
  if ("error" in r) return r.error;
  const mes = r.range.to;

  const [budgets, { goals }, projects, txs] = await Promise.all([
    listBudgets(ctx.houseId, mes),
    listGoals(ctx.houseId),
    listProjects(ctx.houseId),
    listTransactions(ctx.houseId, { month: mes, limit: 3000 }),
  ]);

  const linhas = [`Orçamentos — ${monthLabel(mes)}:`];
  if (budgets.length === 0) linhas.push("- nenhum orçamento definido");
  const totais = new Map(totalsByCategory(txs, mes).map((c) => [c.categoryId, c.totalCents]));
  for (const b of budgets) {
    const limite = toCents(b.limitAmount);
    const gasto = totais.get(b.categoryId) ?? 0;
    const estado = gasto > limite ? `estourou ${R(gasto - limite)}` : `faltam ${R(limite - gasto)}`;
    linhas.push(`- ${nomeCategoria(ctx, b.categoryId)}: gasto ${R(gasto)} de ${R(limite)} — ${estado}`);
  }

  linhas.push("Metas:");
  const ativas = goals.filter((g) => g.status === "active");
  if (ativas.length === 0) linhas.push("- nenhuma meta ativa");
  for (const g of ativas) {
    const prazo = g.targetDate ? ` · prazo ${g.targetDate}` : "";
    linhas.push(`- ${g.name}: ${R(toCents(g.currentAmount))} de ${R(toCents(g.targetAmount))}${prazo}`);
  }

  linhas.push("Projetos:");
  const ativos = projects.filter((p) => p.isActive);
  if (ativos.length === 0) linhas.push("- nenhum projeto ativo");
  for (const p of ativos.slice(0, 5)) {
    const s = projectSummary(await listProjectItems(ctx.houseId, p.id));
    const semCotacao = s.itemsWithoutQuote > 0 ? ` · ${s.itemsWithoutQuote} item(ns) ainda sem cotação` : "";
    linhas.push(`- ${p.name}: previsto ${R(s.expectedCents)}, gasto ${R(s.spentCents)}, falta ${R(s.remainingCents)}${semCotacao}`);
  }
  return linhas.join("\n");
}

// ---------------------------------------------------------------------------
// Classificar e lancar: so propostas
// ---------------------------------------------------------------------------

/** Despesas sem categoria, por loja, com o codigo de cada uma. */
async function listarSemCategoria(ctx: ToolContext, a: { de?: string; ate?: string }): Promise<string> {
  const r = resolveRange(
    a.de || a.ate ? a : { de: addMonths(ctx.today, -11), ate: ctx.today },
    ctx.today,
  );
  if ("error" in r) return r.error;
  const txs = await listTransactions(ctx.houseId, {
    fromMonth: r.range.from,
    toMonth: r.range.to,
    categoryId: "sem",
    limit: 5000,
  });
  const sem = txs.filter((t) => t.type === "expense" && !t.isHidden && t.status !== "cancelled");
  const periodo = `${monthLabel(r.range.from)} a ${monthLabel(r.range.to)}`;
  if (sem.length === 0) return `Nenhuma despesa sem categoria de ${periodo}.`;

  const porLoja = new Map<string, Transaction[]>();
  for (const t of sem) {
    const k = merchantLabel(t);
    porLoja.set(k, [...(porLoja.get(k) ?? []), t]);
  }
  const total = sem.reduce((acc, t) => acc + spendingCents(t), 0);
  const linhas = [`Sem categoria — ${periodo}: ${sem.length} lançamento(s), ${R(total)}, em ${porLoja.size} loja(s).`];
  const lojas = [...porLoja].sort((x, y) => y[1].length - x[1].length);
  for (const [loja, lista] of lojas.slice(0, 25)) {
    const soma = lista.reduce((acc, t) => acc + spendingCents(t), 0);
    const codigos = lista.slice(0, 10).map((t) => refOf(t.id)).join(" ");
    linhas.push(`- ${loja}: ${lista.length}× · ${R(soma)} · ${codigos}${lista.length > 10 ? " …" : ""}`);
  }
  if (lojas.length > 25) linhas.push(`- e mais ${lojas.length - 25} loja(s)`);
  return linhas.join("\n");
}

/** Categoria e subcategoria pelo nome; a sub tem de ser filha da categoria. */
function resolverCategoria(
  ctx: ToolContext,
  categoria: string | undefined,
  subcategoria: string | undefined,
): { categoryId: string | null; subcategoryId: string | null; label: string | null } | string {
  if (!categoria) return { categoryId: null, subcategoryId: null, label: null };
  const c = findCategory(categoria, ctx.categories);
  if (!c) return `Não achei a categoria "${categoria}". Categorias: ${ctx.categories.filter((x) => x.parentId === null && x.isActive).map((x) => x.name).join(", ")}.`;
  // Pediu uma subcategoria pelo nome da categoria: a mae e a dela.
  const mae = c.parentId === null ? c : ctx.categories.find((x) => x.id === c.parentId)!;
  let sub = c.parentId === null ? null : c;
  if (subcategoria) {
    const filhas = ctx.categories.filter((x) => x.parentId === mae.id && x.isActive);
    const achada = findCategory(subcategoria, filhas);
    if (!achada) {
      return `"${subcategoria}" não é subcategoria de ${mae.name}.${filhas.length ? ` As dela: ${filhas.map((x) => x.name).join(", ")}.` : " Ela não tem subcategorias."}`;
    }
    sub = achada;
  }
  return { categoryId: mae.id, subcategoryId: sub?.id ?? null, label: sub ? `${mae.name} › ${sub.name}` : mae.name };
}

function novoId(): string {
  return globalThis.crypto.randomUUID();
}

async function proporClassificacao(
  ctx: ToolContext,
  a: { codigos?: string[]; loja?: string; categoria: string; subcategoria?: string },
): Promise<string> {
  const cat = resolverCategoria(ctx, a.categoria, a.subcategoria);
  if (typeof cat === "string") return cat;

  // Todos os lancamentos da casa (paginado): um codigo pode ser de qualquer mes.
  const todos = await listTransactions(ctx.houseId, { limit: 20_000 });
  let alvo: Transaction[] = [];

  if (a.codigos?.length) {
    for (const ref of a.codigos) {
      const prefixo = refPrefix(ref);
      const achados = todos.filter((t) => t.id.startsWith(prefixo));
      if (achados.length === 0) return `Não achei o lançamento ${ref}. Use os códigos que as ferramentas mostraram.`;
      if (achados.length > 1) return `O código ${ref} aponta para mais de um lançamento. Busque de novo para ver o código completo.`;
      if (!alvo.includes(achados[0]!)) alvo.push(achados[0]!);
    }
  } else if (a.loja) {
    // Pela loja: so os que estao SEM categoria. O que alguem ja classificou
    // e decisao tomada, e proposta nao desfaz decisao.
    const chave = normalizeMerchant(a.loja);
    alvo = todos.filter(
      (t) =>
        t.categoryId === null &&
        t.type === "expense" &&
        (t.merchantNormalized === chave || merchantLabel(t).toLowerCase() === a.loja!.toLowerCase()),
    );
    if (alvo.length === 0) return `Nenhum lançamento sem categoria da loja "${a.loja}".`;
  }

  const lojas = new Set(alvo.map((t) => t.merchantNormalized).filter(Boolean));
  const learnMerchant = lojas.size === 1 ? [...lojas][0]! : null;
  const total = alvo.reduce((acc, t) => acc + spendingCents(t), 0);
  ctx.proposals.push({
    kind: "classificar",
    id: novoId(),
    transactionIds: alvo.map((t) => t.id),
    categoryId: cat.categoryId!,
    subcategoryId: cat.subcategoryId,
    learnMerchant,
    summary: {
      categoryLabel: cat.label!,
      count: alvo.length,
      totalCents: total,
      examples: alvo.slice(0, 4).map((t) => ({ date: t.date, label: merchantLabel(t), cents: spendingCents(t) })),
    },
  });
  return `Proposta criada (ainda NÃO gravada): ${alvo.length} lançamento(s), ${R(total)}, para ${cat.label}. Peça para a casa confirmar no cartão.`;
}

function proporLancamento(
  ctx: ToolContext,
  a: { descricao: string; valor: number; data?: string; categoria?: string; subcategoria?: string; pessoa?: string },
): string {
  const cat = resolverCategoria(ctx, a.categoria, a.subcategoria);
  if (typeof cat === "string") return cat;

  let memberId: string | null = null;
  let isJoint = false;
  let personLabel: string | null = null;
  if (a.pessoa) {
    if (/^(os dois|os 2|ambos|todos|nos dois|n[oó]s)$/i.test(a.pessoa.trim())) {
      isJoint = ctx.members.length > 1;
      personLabel = isJoint ? (ctx.members.length === 2 ? "Os dois" : "Todos") : null;
    } else {
      const m = findMember(a.pessoa, ctx.members);
      if (!m) return `Não achei a pessoa "${a.pessoa}". Pessoas: ${ctx.members.map((x) => firstName(x.fullName)).join(", ")}.`;
      memberId = m.userId;
      personLabel = firstName(m.fullName);
    }
  }

  const data = a.data ?? ctx.todayIso;
  if (Number.isNaN(new Date(`${data}T12:00:00Z`).getTime())) return `Data inválida: ${data}.`;
  const amountCents = toCents(a.valor);
  ctx.proposals.push({
    kind: "lancar",
    id: novoId(),
    fields: {
      description: a.descricao,
      amountCents,
      date: data,
      invoiceMonth: data.slice(0, 7),
      categoryId: cat.categoryId,
      subcategoryId: cat.subcategoryId,
      memberId,
      isJoint,
    },
    summary: { categoryLabel: cat.label, personLabel },
  });
  return `Proposta criada (ainda NÃO gravada): ${a.descricao}, ${R(amountCents)}, em ${data}${cat.label ? `, ${cat.label}` : ", sem categoria"}${personLabel ? `, de ${personLabel}` : ""}. Peça para a casa confirmar no cartão.`;
}

/**
 * Executa uma ferramenta pedida pelo modelo.
 *
 * Nome desconhecido e argumento invalido viram FRASE para o modelo, e nao
 * erro: ele pode corrigir e pedir de novo, e a conversa segue.
 */
export async function runTool(
  ctx: ToolContext,
  name: string,
  rawArgs: string,
): Promise<{ output: string; tool: ToolName | null }> {
  if (!isToolName(name)) return { output: `Ferramenta desconhecida: ${name}.`, tool: null };

  let json: unknown = {};
  try {
    json = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { output: "Argumentos em JSON inválido.", tool: name };
  }
  const parsed = TOOL_ARGS[name].safeParse(json ?? {});
  if (!parsed.success) {
    return { output: `Argumentos inválidos: ${parsed.error.issues[0]?.message ?? "confira"}.`, tool: name };
  }

  const a = parsed.data as never;
  let output: string;
  switch (name) {
    case "resumo_do_mes":
      output = await resumoDoMes(ctx, a);
      break;
    case "gastos_por_categoria":
      output = await gastosPorCategoria(ctx, a);
      break;
    case "buscar_lancamentos":
      output = await buscarLancamentos(ctx, a);
      break;
    case "principais_lojas":
      output = await principaisLojas(ctx, a);
      break;
    case "parcelas_futuras":
      output = await parcelasFuturas(ctx);
      break;
    case "orcamentos_metas_projetos":
      output = await orcamentosMetasProjetos(ctx, a);
      break;
    case "listar_sem_categoria":
      output = await listarSemCategoria(ctx, a);
      break;
    case "propor_classificacao":
      output = await proporClassificacao(ctx, a);
      break;
    case "propor_lancamento":
      output = proporLancamento(ctx, a);
      break;
  }
  return { output: capToolOutput(output), tool: name };
}

/** O retrato do mes que vai no prompt - o mesmo texto da ferramenta. */
export async function snapshotFor(ctx: ToolContext, month: MonthKey): Promise<string> {
  return resumoDoMes(ctx, { mes: month });
}
