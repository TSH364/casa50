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
import { ROUTE_QUESTION, decideRoute, routeState, shouldFallBack } from "@/domain/chat-router";
import type { Route, Tier } from "@/domain/chat-router";
import {
  MAX_TOOL_ROUNDS,
  TOOL_DEFINITIONS,
  TOOL_LABEL,
  buildSystemPrompt,
  firstName,
  trimHistory,
} from "@/domain/chat";
import type { Proposal, ToolName } from "@/domain/chat";
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
  const route = decideRoute(pergunta, jev?.answers.get("rota")?.complexidade ?? null);

  const modelos: Record<Tier, { model: string; allowDataCollection: boolean }> = {
    // O gratuito aceita provedor que guarda: sem isso, nenhum gratuito atende.
    gratuito: { model: process.env.OPENROUTER_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL, allowDataCollection: true },
    pago: { model: process.env.OPENROUTER_CHAT_PAID_MODEL?.trim() || DEFAULT_CHAT_PAID_MODEL, allowDataCollection: false },
  };

  const inicio = Date.now();
  const conversar = (tier: Tier) =>
    runConversation(ctx, apiKey, system, historico, modelos[tier], PRAZO_MS - (Date.now() - inicio));

  try {
    const r = await conversar(route.tier);
    return { ...r, tier: route.tier, route: route.reason };
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
        return { ...r, tier: "pago", route: route.reason, fellBack: true };
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
async function runConversation(
  ctx: ToolContext,
  apiKey: string,
  system: string,
  historico: ReturnType<typeof trimHistory>,
  alvo: { model: string; allowDataCollection: boolean },
  prazoMs: number,
): Promise<ChatReply> {
  const conversa: TurnMessage[] = [{ role: "system", content: system }, ...historico];
  const consultadas = new Set<ToolName>();
  // Uma tentativa que falhou no gratuito nao deixa proposta para tras.
  ctx.proposals.length = 0;
  const inicio = Date.now();

  for (let rodada = 0; rodada <= MAX_TOOL_ROUNDS; rodada += 1) {
    const resta = prazoMs - (Date.now() - inicio);
    if (resta < 3_000) break;
    const ultima = rodada === MAX_TOOL_ROUNDS || resta < 15_000;

    const turn = await chatTurn(conversa, {
      apiKey,
      model: alvo.model,
      tools: ultima ? [] : TOOL_DEFINITIONS,
      allowDataCollection: alvo.allowDataCollection,
      timeoutMs: Math.min(25_000, resta),
    });

    if (turn.toolCalls.length === 0 || ultima) {
      if (!turn.content) break;
      return {
        answer: turn.content.trim(),
        consulted: [...consultadas].map((t) => TOOL_LABEL[t]),
        model: turn.servedBy,
        ...(ctx.proposals.length > 0 ? { proposals: [...ctx.proposals] } : {}),
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
  revalidatePath("/insights");
}
