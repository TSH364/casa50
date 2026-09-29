"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { fromMonthKey } from "@/data/mappers";
import { fromCents } from "@/lib/money";
import { requireHouseId } from "./shared";
import { getAiKey } from "@/lib/ai-config";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { houseView } from "@/lib/house-view";
import { listMonthsWithData } from "@/data/queries";
import { runTool, snapshotFor } from "@/lib/chat-tools";
import type { ToolContext } from "@/lib/chat-tools";
import { OpenRouterError, chatTurn } from "@/lib/openrouter";
import type { TurnMessage } from "@/lib/openrouter";
import { DEFAULT_CHAT_MODEL, DEFAULT_CHAT_PAID_MODEL } from "@/domain/ai-models";
import { runJev } from "@/lib/jev-run";
import { recordAiUsage } from "@/lib/ai-usage";
import { JEV_MODEL } from "@/domain/ai-models";
import {
  ROUTE_QUESTION,
  decideRoute,
  isPdfRequest,
  pdfTarget,
  routeState,
  shouldFallBack,
} from "@/domain/chat-router";
import type { Route, Tier } from "@/domain/chat-router";
import {
  MAX_TOOL_ROUNDS,
  TOOL_DEFINITIONS,
  TOOL_LABEL,
  buildSystemPrompt,
  firstName,
  trimHistory,
} from "@/domain/chat";
import type { ChartSpec, Proposal, ToolName } from "@/domain/chat";
import type { ShoppingSearch } from "@/domain/shopping";
import { DEFAULT_LISTS } from "@/domain/tasks";
import { DOS_DOIS } from "@/domain/schemas";
import { isMonthKey } from "@/domain/month";
import { createGoal } from "./goals";
import { setBudget } from "./budgets";
import { createRecurrence } from "./recurrences";
import { moveTask, updateTask } from "./tasks";
import { currentMonth } from "@/domain/month";

/**
 * Uma pergunta a conversa (secao 16).
 *
 * O laco: o modelo responde, ou pede ferramentas; o servidor executa e
 * devolve o resultado; ate `MAX_TOOL_ROUNDS` vezes. Na ultima rodada vai sem
 * ferramentas, para ele fechar com o que ja tem em vez de pedir de novo.
 *
 * A casa e conferida ANTES de tudo: acao de servidor e endereco publico, e
 * sem isto qualquer um gastaria a cota da chave da casa - e leria os dados
 * dela pela boca da IA.
 */

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4_000),
      }),
    )
    .min(1)
    .max(60)
    .refine((m) => m[m.length - 1]?.role === "user", "A última mensagem tem de ser a pergunta."),
});

export interface ChatReply {
  error?: string;
  /** `false` quando a casa nao tem chave: a tela explica onde por. */
  configured?: boolean;
  answer?: string;
  /** O que a IA consultou para responder, em palavras. */
  consulted?: string[];
  /** Modelo que respondeu - o roteador gratuito escolhe um a cada vez. */
  model?: string | null;
  /** Qual dos dois respondeu, e por que (ver `domain/chat-router.ts`). */
  tier?: Tier;
  route?: Route["reason"];
  /** O gratuito falhou e o pago assumiu. */
  fellBack?: boolean;
  /** Mudancas propostas - NAO gravadas; a tela mostra como cartoes. */
  proposals?: Proposal[];
  /** Graficos com numeros do app, para desenhar abaixo da resposta. */
  charts?: ChartSpec[];
  /** Pesquisas de compra: ofertas conferidas, com os links. */
  searches?: ShoppingSearch[];
  /**
   * So quando a pergunta pediu PDF: de qual resposta ele e. Sem pedido, sem
   * botao - ver `isPdfRequest`.
   */
  pdf?: "esta" | "anterior";
}

/** Tempo total da pergunta, abaixo do `maxDuration` da pagina. */
const PRAZO_MS = 50_000;
/** Ferramentas por rodada. Mais que isso e o modelo se perdendo. */
const MAX_CALLS_PER_ROUND = 4;

export async function askHouse(input: z.input<typeof schema>): Promise<ChatReply> {
  const houseId = await requireHouseId();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Mensagem inválida." };

  const apiKey = await getAiKey(houseId);
  if (!apiKey) {
    return {
      configured: false,
      error: "A conversa usa a chave do OpenRouter da casa. Guarde uma na tela Casa.",
    };
  }

  const today = currentMonth();
  const [{ active }, members, view, months] = await Promise.all([
    getActiveHouse(),
    listMembers(houseId),
    houseView(houseId),
    listMonthsWithData(houseId),
  ]);

  const ctx: ToolContext = {
    houseId,
    today,
    members,
    categories: view.categories,
    excludeCategoryIds: view.excludeCategoryIds,
    proposals: [],
    charts: [],
    searches: [],
    apiKey,
    // AAAA-MM-DD no fuso da casa: "gastei ontem" as 23h nao pode cair amanha.
    todayIso: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }),
  };

  // O mes do retrato: o atual, ou o mais recente com dados que nao seja
  // futuro (meses futuros so tem parcela, e resumir isso engana).
  const mesDoRetrato = months.find((m) => m <= today) ?? today;
  const snapshot = await snapshotFor(ctx, mesDoRetrato);

  const system = buildSystemPrompt({
    houseName: active?.name ?? "a casa",
    today: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    currentMonth: today,
    members: members.map((m) => firstName(m.fullName)),
    categories: view.categories
      .filter((c) => c.parentId === null && c.isActive)
      .map((c) => {
        const subs = view.categories.filter((s) => s.parentId === c.id && s.isActive).map((s) => s.name);
        return subs.length > 0 ? `${c.name} (subcategorias: ${subs.join(", ")})` : c.name;
      }),
    excludedCategories: view.excluded.map((c) => c.name),
    // Cartoes nao vao: nenhuma ferramenta filtra por cartao, e o nome que a
    // importacao cria ("Cartao 6869") carrega o final - que a tela promete
    // nao mandar.
    monthsWithData: months,
    snapshot,
  });

  const historico = trimHistory(parsed.data.messages);
  const pergunta = historico[historico.length - 1]!.content;
  const anterior = historico.length >= 2 ? historico[historico.length - 2]!.content : null;

  // O Jev decide a rota. Uma chamada curta (so a pergunta), com prazo curto:
  // se ele nao responder a tempo, a pergunta vai ao pago e a conversa segue.
  const jev = await runJev(
    [{ key: "rota", state: routeState(pergunta, anterior), questions: { complexidade: ROUTE_QUESTION } }],
    { apiKey, maxJobs: 1, deadlineMs: 6_000 },
  ).catch(() => null);
  if (jev) await recordAiUsage(houseId, "jev", { calls: jev.calls, costUsd: jev.costUsd, model: JEV_MODEL });
  const route = decideRoute(pergunta, jev?.answers.get("rota")?.complexidade ?? null);

  const modelos: Record<Tier, { model: string; allowDataCollection: boolean }> = {
    // O gratuito aceita provedor que guarda: sem isso, nenhum gratuito atende.
    gratuito: { model: process.env.OPENROUTER_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL, allowDataCollection: true },
    pago: { model: process.env.OPENROUTER_CHAT_PAID_MODEL?.trim() || DEFAULT_CHAT_PAID_MODEL, allowDataCollection: false },
  };

  const inicio = Date.now();
  ctx.deadline = inicio + PRAZO_MS;
  // O gasto de cada tentativa e anotado mesmo quando ela falha no meio: as
  // chamadas feitas ate ali ja contaram na cota e no credito.
  const conversar = async (tier: Tier) => {
    const gasto: Gasto = { calls: 0, costUsd: 0, model: null };
    try {
      return await runConversation(ctx, apiKey, system, historico, modelos[tier], PRAZO_MS - (Date.now() - inicio), gasto);
    } finally {
      await recordAiUsage(houseId, tier === "pago" ? "conversa_paga" : "conversa_gratuita", gasto);
    }
  };

  const comPdf = (r: ChatReply): ChatReply =>
    r.answer && isPdfRequest(pergunta)
      ? { ...r, pdf: pdfTarget((r.charts?.length ?? 0) > 0, anterior !== null) }
      : r;

  try {
    const r = await conversar(route.tier);
    return comPdf({ ...r, tier: route.tier, route: route.reason });
  } catch (e) {
    // O gratuito falhou de um jeito que o pago resolve (cota, privacidade,
    // provedor fora): tenta de novo no pago, se ainda houver tempo.
    if (
      route.tier === "gratuito" &&
      e instanceof OpenRouterError &&
      shouldFallBack(e.status) &&
      PRAZO_MS - (Date.now() - inicio) > 15_000
    ) {
      try {
        const r = await conversar("pago");
        return comPdf({ ...r, tier: "pago", route: route.reason, fellBack: true });
      } catch (e2) {
        return erroDaConversa(e2);
      }
    }
    return erroDaConversa(e);
  }
}

function erroDaConversa(e: unknown): ChatReply {
  if (e instanceof OpenRouterError) return { error: e.message };
  console.error("[conversa] falha", { erro: e instanceof Error ? e.name : "desconhecido" });
  return { error: "A conversa falhou. Tente de novo." };
}

/**
 * O laco de uma pergunta, num modelo: responde, ou pede ferramentas; ate
 * `MAX_TOOL_ROUNDS` vezes, e a ultima rodada vai sem ferramentas, para fechar.
 * Erro do OpenRouter sobe para quem chamou decidir se tenta no outro modelo.
 */
interface Gasto {
  calls: number;
  costUsd: number;
  model: string | null;
}

async function runConversation(
  ctx: ToolContext,
  apiKey: string,
  system: string,
  historico: ReturnType<typeof trimHistory>,
  alvo: { model: string; allowDataCollection: boolean },
  prazoMs: number,
  gasto: Gasto,
): Promise<ChatReply> {
  const conversa: TurnMessage[] = [{ role: "system", content: system }, ...historico];
  const consultadas = new Set<ToolName>();
  // Uma tentativa que falhou no gratuito nao deixa proposta para tras.
  ctx.proposals.length = 0;
  ctx.charts.length = 0;
  ctx.searches.length = 0;
  const inicio = Date.now();

  for (let rodada = 0; rodada <= MAX_TOOL_ROUNDS; rodada += 1) {
    const resta = prazoMs - (Date.now() - inicio);
    if (resta < 3_000) break;
    const ultima = rodada === MAX_TOOL_ROUNDS || resta < 15_000;

    gasto.calls += 1;
    gasto.model ??= alvo.model;
    const turn = await chatTurn(conversa, {
      apiKey,
      model: alvo.model,
      tools: ultima ? [] : TOOL_DEFINITIONS,
      allowDataCollection: alvo.allowDataCollection,
      timeoutMs: Math.min(25_000, resta),
    });
    gasto.costUsd += turn.costUsd;
    if (turn.servedBy) gasto.model = turn.servedBy;

    if (turn.toolCalls.length === 0 || ultima) {
      if (!turn.content) break;
      return {
        answer: turn.content.trim(),
        consulted: [...consultadas].map((t) => TOOL_LABEL[t]),
        model: turn.servedBy,
        ...(ctx.proposals.length > 0 ? { proposals: [...ctx.proposals] } : {}),
        ...(ctx.charts.length > 0 ? { charts: [...ctx.charts] } : {}),
        ...(ctx.searches.length > 0 ? { searches: [...ctx.searches] } : {}),
      };
    }

    const chamadas = turn.toolCalls.slice(0, MAX_CALLS_PER_ROUND);
    conversa.push({ role: "assistant", content: turn.content, tool_calls: chamadas });
    for (const c of chamadas) {
      const r = await runTool(ctx, c.function.name, c.function.arguments);
      if (r.tool) consultadas.add(r.tool);
      conversa.push({ role: "tool", tool_call_id: c.id, content: r.output });
    }
  }
  return { error: "A IA não chegou a uma resposta. Tente perguntar de um jeito mais direto." };
}

// ---------------------------------------------------------------------------
// Confirmar uma proposta
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();
const proposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("classificar"),
    transactionIds: z.array(uuid).min(1).max(1000),
    categoryId: uuid,
    subcategoryId: uuid.nullable(),
    learnMerchant: z.string().trim().min(1).max(300).nullable(),
    /** A pessoa pode desmarcar "aprender" no cartao. */
    learn: z.boolean(),
  }),
  z.object({
    kind: z.literal("lancar"),
    fields: z.object({
      description: z.string().trim().min(2).max(200),
      amountCents: z.number().int().positive().max(1_000_000_000),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      invoiceMonth: z.string().regex(/^\d{4}-\d{2}$/),
      categoryId: uuid.nullable(),
      subcategoryId: uuid.nullable(),
      memberId: uuid.nullable(),
      isJoint: z.boolean(),
    }),
  }),
  z.object({
    kind: z.literal("meta"),
    fields: z.object({
      name: z.string().trim().min(1).max(120),
      targetCents: z.number().int().positive().max(9_999_999_900),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      monthlyCents: z.number().int().min(0).max(9_999_999_900).nullable(),
      ownerId: uuid.nullable(),
    }),
  }),
  z.object({
    kind: z.literal("orcamento"),
    fields: z.object({
      categoryId: uuid,
      month: z.string().refine(isMonthKey),
      limitCents: z.number().int().min(0).max(9_999_999_999),
    }),
  }),
  z.object({
    kind: z.literal("conta_fixa"),
    fields: z.object({
      description: z.string().trim().min(1).max(120),
      merchant: z.string().trim().max(120).nullable(),
      amountCents: z.number().int().min(0).max(9_999_999_900),
      interval: z.enum(["weekly", "monthly", "yearly"]),
      expectedDay: z.number().int().min(1).max(31).nullable(),
      categoryId: uuid.nullable(),
    }),
  }),
  z.object({
    kind: z.literal("mudar_tarefa"),
    fields: z.object({
      taskId: uuid,
      listId: uuid.optional(),
      done: z.boolean().optional(),
      who: z.union([uuid, z.literal(DOS_DOIS), z.literal("")]).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      expectedCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    }),
  }),
  z.object({
    kind: z.literal("tarefa"),
    fields: z.object({
      title: z.string().trim().min(1).max(200),
      expectedCents: z.number().int().min(0).max(1_000_000_000).nullable(),
      notes: z.string().trim().max(4000).nullable(),
    }),
  }),
]);

export interface ApplyProposalResult {
  error?: string;
  ok?: boolean;
  /** Quantos lancamentos mudaram (classificar) ou 1 (lancar). */
  count?: number;
}

/**
 * Grava uma proposta da conversa - so depois do toque em "Confirmar".
 *
 * TUDO e conferido de novo aqui, porque a proposta passou pelo navegador:
 * os lancamentos sao desta casa, a categoria e desta casa e e categoria-mae,
 * a subcategoria e filha dela, a pessoa e da casa. Uma proposta adulterada
 * no navegador so consegue o que a pessoa ja conseguiria pelas telas.
 */
export async function applyProposal(input: unknown): Promise<ApplyProposalResult> {
  const houseId = await requireHouseId();
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) return { error: "Proposta inválida." };
  const p = parsed.data;
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);

  const categoriaOk = async (categoryId: string | null, subcategoryId: string | null) => {
    if (categoryId === null) return subcategoryId === null;
    const ids = subcategoryId ? [categoryId, subcategoryId] : [categoryId];
    const { data } = await supabase
      .from("categories")
      .select("id, parent_id")
      .eq("house_id", houseId)
      .in("id", ids);
    const mae = (data ?? []).find((c) => c.id === categoryId);
    if (!mae || mae.parent_id !== null) return false;
    if (subcategoryId === null) return true;
    return (data ?? []).some((c) => c.id === subcategoryId && c.parent_id === categoryId);
  };

  if (p.kind === "classificar") {
    if (!(await categoriaOk(p.categoryId, p.subcategoryId))) return { error: "Categoria não encontrada." };
    const { data: marcados, error } = await supabase
      .from("transactions")
      .update({ category_id: p.categoryId, subcategory_id: p.subcategoryId })
      .eq("house_id", houseId)
      .in("id", p.transactionIds)
      .select("id");
    if (error) {
      console.error("[conversa] falha ao classificar", { code: error.code });
      return { error: "Não foi possível classificar." };
    }
    if (p.learn && p.learnMerchant) {
      // A casa confirmou: agora e decisao dela, e vira regra para as proximas
      // faturas - como qualquer correcao feita a mao no extrato.
      const { error: erroRegra } = await supabase.from("learned_rules").upsert(
        {
          house_id: houseId,
          pattern: p.learnMerchant,
          category_id: p.categoryId,
          subcategory_id: p.subcategoryId,
          created_by: user?.id ?? null,
        },
        { onConflict: "house_id,normalized_pattern" },
      );
      if (erroRegra) console.error("[conversa] falha ao aprender a regra", { code: erroRegra.code });
    }
    revalidarLancamentos();
    return { ok: true, count: marcados?.length ?? 0 };
  }

  // Metas, orcamentos, contas fixas e tarefas: pelas MESMAS acoes das telas,
  // com as mesmas validacoes - a conversa nao ganha um caminho mais frouxo.
  const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  if (p.kind === "meta") {
    const f = p.fields;
    if (f.ownerId !== null && !(await listMembers(houseId)).some((m) => m.userId === f.ownerId)) {
      return { error: "Essa pessoa não é da casa." };
    }
    const r = await createGoal(
      {},
      form({
        name: f.name,
        targetAmount: reais(f.targetCents),
        targetDate: f.targetDate ?? "",
        monthlyContribution: f.monthlyCents === null ? "" : reais(f.monthlyCents),
        ownerId: f.ownerId ?? "",
      }),
    );
    return r.error ? { error: r.error } : { ok: true, count: 1 };
  }

  if (p.kind === "orcamento") {
    if (!(await categoriaOk(p.fields.categoryId, null))) return { error: "Categoria não encontrada." };
    const r = await setBudget(p.fields);
    if (r.error) return { error: r.error };
    revalidatePath("/analise");
    return { ok: true, count: 1 };
  }

  if (p.kind === "conta_fixa") {
    const f = p.fields;
    if (!(await categoriaOk(f.categoryId, null))) return { error: "Categoria não encontrada." };
    const r = await createRecurrence(
      {},
      form({
        description: f.description,
        merchant: f.merchant ?? "",
        amount: reais(f.amountCents),
        interval: f.interval,
        expectedDay: f.expectedDay === null ? "" : String(f.expectedDay),
        categoryId: f.categoryId ?? "",
      }),
    );
    return r.error ? { error: r.error } : { ok: true, count: 1 };
  }

  if (p.kind === "mudar_tarefa") {
    const f = p.fields;
    const { data: t } = await supabase
      .from("tasks")
      .select("id, list_id, title, notes, member_id, is_joint, due_date, expected_amount, done")
      .eq("house_id", houseId)
      .eq("id", f.taskId)
      .maybeSingle();
    if (!t) return { error: "Tarefa não encontrada." };
    const atual = t.is_joint ? DOS_DOIS : ((t.member_id as string | null) ?? "");
    const r = await updateTask({
      id: f.taskId,
      title: String(t.title),
      notes: (t.notes as string | null) ?? null,
      who: f.who ?? atual,
      dueDate: f.dueDate !== undefined ? f.dueDate : ((t.due_date as string | null) ?? null),
      expectedCents:
        f.expectedCents !== undefined
          ? f.expectedCents
          : t.expected_amount === null
            ? null
            : Math.round(Number(t.expected_amount) * 100),
      done: f.done ?? t.done === true,
    });
    if (r.error) return { error: r.error };
    if (f.listId && f.listId !== t.list_id) {
      // No fim da coluna de destino - como arrastar e soltar no fim.
      const m = await moveTask({ id: f.taskId, listId: f.listId, index: Number.MAX_SAFE_INTEGER });
      if (m.error) return { error: m.error };
    }
    return { ok: true, count: 1 };
  }

  if (p.kind === "tarefa") {
    // Na primeira coluna do quadro, no fim; quadro vazio ganha as colunas de
    // partida, como no botao da tela de Tarefas.
    let { data: colunas } = await supabase
      .from("task_lists")
      .select("id")
      .eq("house_id", houseId)
      .order("position")
      .limit(1);
    if (!colunas || colunas.length === 0) {
      const { data: criadas, error: erroQuadro } = await supabase
        .from("task_lists")
        .insert(DEFAULT_LISTS.map((name, position) => ({ house_id: houseId, name, position })))
        .select("id, position");
      if (erroQuadro) {
        console.error("[conversa] falha ao criar o quadro", { code: erroQuadro.code });
        return { error: "Não foi possível criar a tarefa." };
      }
      colunas = [...(criadas ?? [])].sort((a, b) => Number(a.position) - Number(b.position));
    }
    const listId = colunas?.[0]?.id as string | undefined;
    if (!listId) return { error: "Não foi possível criar a tarefa." };
    const { data: ultimas } = await supabase
      .from("tasks")
      .select("position")
      .eq("house_id", houseId)
      .eq("list_id", listId)
      .order("position", { ascending: false })
      .limit(1);
    const { error } = await supabase.from("tasks").insert({
      house_id: houseId,
      list_id: listId,
      title: p.fields.title,
      notes: p.fields.notes,
      expected_amount: p.fields.expectedCents === null ? null : fromCents(p.fields.expectedCents),
      position: ultimas && ultimas.length > 0 ? Number(ultimas[0]!.position) + 1 : 0,
      created_by: user?.id ?? null,
    });
    if (error) {
      console.error("[conversa] falha ao criar a tarefa", { code: error.code });
      return { error: "Não foi possível criar a tarefa." };
    }
    revalidatePath("/tarefas");
    return { ok: true, count: 1 };
  }

  const f = p.fields;
  if (!(await categoriaOk(f.categoryId, f.subcategoryId))) return { error: "Categoria não encontrada." };
  if (f.isJoint && f.memberId !== null) return { error: "Gasto dos dois não tem uma pessoa só." };
  if (f.memberId !== null) {
    const membros = await listMembers(houseId);
    if (!membros.some((m) => m.userId === f.memberId)) return { error: "Essa pessoa não é da casa." };
  }
  const { error } = await supabase.from("transactions").insert({
    house_id: houseId,
    origin: "manual",
    status: "confirmed",
    type: "expense",
    visibility: "shared",
    description: f.description,
    merchant_original: f.description,
    amount: fromCents(f.amountCents),
    date: f.date,
    invoice_month: fromMonthKey(f.invoiceMonth),
    category_id: f.categoryId,
    subcategory_id: f.subcategoryId,
    member_id: f.memberId,
    is_joint: f.isJoint,
    created_by: user?.id ?? null,
  });
  if (error) {
    console.error("[conversa] falha ao lançar", { code: error.code });
    return { error: "Não foi possível lançar." };
  }
  revalidarLancamentos();
  return { ok: true, count: 1 };
}

function revalidarLancamentos() {
  revalidatePath("/inicio");
  revalidatePath("/extratos");
  revalidatePath("/analise");
}
