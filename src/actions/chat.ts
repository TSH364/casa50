"use server";

import { z } from "zod";
import { requireHouseId } from "./shared";
import { getAiKey } from "@/lib/ai-config";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { houseView } from "@/lib/house-view";
import { listMonthsWithData } from "@/data/queries";
import { runTool, snapshotFor } from "@/lib/chat-tools";
import type { ToolContext } from "@/lib/chat-tools";
import { OpenRouterError, chatTurn } from "@/lib/openrouter";
import type { TurnMessage } from "@/lib/openrouter";
import { DEFAULT_CHAT_MODEL } from "@/domain/ai-models";
import {
  MAX_TOOL_ROUNDS,
  TOOL_DEFINITIONS,
  TOOL_LABEL,
  buildSystemPrompt,
  firstName,
  trimHistory,
} from "@/domain/chat";
import type { ToolName } from "@/domain/chat";
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

  const conversa: TurnMessage[] = [
    { role: "system", content: system },
    ...trimHistory(parsed.data.messages),
  ];
  const model = process.env.OPENROUTER_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  const consultadas = new Set<ToolName>();
  const inicio = Date.now();

  try {
    for (let rodada = 0; rodada <= MAX_TOOL_ROUNDS; rodada += 1) {
      const resta = PRAZO_MS - (Date.now() - inicio);
      if (resta < 3_000) break;
      const ultima = rodada === MAX_TOOL_ROUNDS || resta < 15_000;

      const turn = await chatTurn(conversa, {
        apiKey,
        model,
        tools: ultima ? [] : TOOL_DEFINITIONS,
        allowDataCollection: true,
        timeoutMs: Math.min(25_000, resta),
      });

      if (turn.toolCalls.length === 0 || ultima) {
        if (!turn.content) break;
        return {
          answer: turn.content.trim(),
          consulted: [...consultadas].map((t) => TOOL_LABEL[t]),
          model: turn.servedBy,
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
  } catch (e) {
    if (e instanceof OpenRouterError) return { error: e.message };
    console.error("[conversa] falha", { erro: e instanceof Error ? e.name : "desconhecido" });
    return { error: "A conversa falhou. Tente de novo." };
  }

  return { error: "A IA não chegou a uma resposta. Tente perguntar de um jeito mais direto." };
}
