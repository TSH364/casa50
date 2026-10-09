"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getAiKey } from "@/lib/ai-config";
import { recordAiUsage } from "@/lib/ai-usage";
import { chatCompletion, OpenRouterError } from "@/lib/openrouter";
import { GmailError, credenciaisGoogle, lerMensagem, listarMensagens, tokenDeAcesso } from "@/lib/gmail";
import { tabelaAusente } from "@/data/radar";
import { DEFAULT_CHAT_PAID_MODEL } from "@/domain/ai-models";
import {
  HORAS_ENTRE_LEITURAS,
  INSTRUCOES_SECRETARIO,
  LOTE_IA,
  MAX_POR_LEITURA,
  buscaDoGmail,
  conferirClassificacao,
  lerMensagemGmail,
  promptDosEmails,
  type EmailLido,
} from "@/domain/secretario";
import { fromCents } from "@/lib/money";
import { requireHouseId } from "./shared";

/**
 * O secretario: le o Gmail conectado de cada pessoa e guarda o que pede algo.
 *
 * Como o Meu Pluggy, roda com a sessao de quem abriu o app (sem robo de
 * madrugada, que exigiria a chave de servico do Supabase na Vercel): a
 * abertura do app le os Gmails vencidos depois que a pagina foi enviada, e o
 * botao "Ler agora" forca.
 *
 * Guarda de cada e-mail so o que a tela mostra - remetente, assunto, data,
 * tipo, resumo, valor e datas. O corpo vai a IA e e descartado.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface ConexaoComToken {
  id: string;
  member_id: string;
  email_address: string;
  refresh_token: string;
  last_sync_at: string | null;
}

export interface LeituraResult {
  novos: number;
  erros: string[];
}

/** A abertura do app (ver o layout): so os Gmails vencidos, em silencio. */
export async function syncSecretario(): Promise<void> {
  try {
    if (!credenciaisGoogle()) return;
    const houseId = await requireHouseId();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("claim_email_sync", {
      p_house: houseId,
      p_hours: HORAS_ENTRE_LEITURAS,
    });
    if (error || !data || (data as string[]).length === 0) return;
    await ler(supabase, houseId, new Set(data as string[]));
  } catch (e) {
    console.error("[secretario] leitura automatica falhou", { message: e instanceof Error ? e.message : "?" });
  }
}

/** O botao "Ler agora". */
export async function lerEmailsAgora(): Promise<LeituraResult & { error?: string }> {
  if (!credenciaisGoogle()) return { novos: 0, erros: [], error: "O Gmail ainda não foi configurado no servidor." };
  const houseId = await requireHouseId();
  const supabase = await createClient();
  return ler(supabase, houseId, "todas");
}

async function ler(supabase: Supabase, houseId: string, quais: "todas" | Set<string>): Promise<LeituraResult> {
  const cred = credenciaisGoogle();
  if (!cred) return { novos: 0, erros: [] };

  const { data: raw, error } = await supabase.rpc("email_connection_secrets", { p_house: houseId });
  if (error) {
    if (!tabelaAusente(error.code)) console.error("[secretario] falha ao ler conexoes", { code: error.code });
    return { novos: 0, erros: ["Não foi possível ler as conexões do Gmail."] };
  }
  const conexoes = ((raw ?? []) as ConexaoComToken[]).filter((c) => quais === "todas" || quais.has(c.id));
  if (conexoes.length === 0) return { novos: 0, erros: [] };

  const apiKey = await getAiKey(houseId);
  if (!apiKey) {
    const msg = "A IA não está configurada nesta casa: o secretário precisa dela para separar os e-mails.";
    for (const c of conexoes) await supabase.rpc("mark_email_sync", { p_connection: c.id, p_error: msg });
    return { novos: 0, erros: [msg] };
  }

  const agora = new Date();
  const hoje = agora.toISOString().slice(0, 10);
  let novos = 0;
  const erros: string[] = [];
  let chamadas = 0;
  let custo = 0;
  let modelo: string | null = DEFAULT_CHAT_PAID_MODEL;

  for (const c of conexoes) {
    try {
      const token = await tokenDeAcesso(c.refresh_token, cred);
      const ids = await listarMensagens(token, buscaDoGmail(c.last_sync_at, agora), MAX_POR_LEITURA);

      // O que ja foi lido numa vez anterior (a janela volta um dia de proposito).
      const jaLidos = new Set<string>();
      if (ids.length > 0) {
        const { data: vistos } = await supabase
          .from("email_items")
          .select("gmail_id")
          .eq("house_id", houseId)
          .in("gmail_id", ids);
        for (const v of vistos ?? []) jaLidos.add(v.gmail_id as string);
      }
      const faltam = ids.filter((id) => !jaLidos.has(id));

      const emails: EmailLido[] = [];
      for (let i = 0; i < faltam.length; i += 10) {
        const lote = await Promise.all(faltam.slice(i, i + 10).map((id) => lerMensagem(token, id)));
        for (const m of lote) {
          const e = lerMensagemGmail(m);
          if (e) emails.push(e);
        }
      }

      let falhouIa = false;
      for (let i = 0; i < emails.length; i += LOTE_IA) {
        const lote = emails.slice(i, i + LOTE_IA);
        let resposta: string;
        try {
          chamadas += 1;
          resposta = await chatCompletion(
            [
              { role: "system", content: INSTRUCOES_SECRETARIO },
              { role: "user", content: promptDosEmails(lote, hoje) },
            ],
            {
              apiKey,
              model: DEFAULT_CHAT_PAID_MODEL,
              maxTokens: 2500,
              timeoutMessage: "A IA demorou demais para separar os e-mails.",
              onUsage: (u) => {
                custo += u.costUsd;
                modelo = u.model;
              },
            },
          );
        } catch (e) {
          falhouIa = true;
          erros.push(e instanceof OpenRouterError ? e.message : "A IA não conseguiu separar os e-mails.");
          break;
        }
        const itens = conferirClassificacao(resposta, lote);
        if (!itens) {
          // Nada gravado: o lote volta na proxima leitura.
          falhouIa = true;
          erros.push("A IA respondeu num formato inesperado.");
          break;
        }
        const porId = new Map(lote.map((e) => [e.gmailId, e]));
        const linhas = itens.map((it) => {
          const e = porId.get(it.gmailId)!;
          return {
            house_id: houseId,
            connection_id: c.id,
            member_id: c.member_id,
            gmail_id: it.gmailId,
            from_name: e.fromName,
            from_address: e.fromAddress,
            subject: e.subject,
            received_at: e.receivedAt,
            kind: it.tipo,
            summary: it.resumo,
            amount: it.amountCents === null ? null : fromCents(it.amountCents),
            due_date: it.dueDate,
            event_date: it.eventDate,
          };
        });
        const { error: insError } = await supabase
          .from("email_items")
          .upsert(linhas, { onConflict: "house_id,gmail_id", ignoreDuplicates: true });
        if (insError) {
          console.error("[secretario] falha ao gravar", { code: insError.code });
          falhouIa = true;
          erros.push("Não foi possível guardar os e-mails separados.");
          break;
        }
        novos += linhas.filter((l) => l.kind !== "informativo").length;
      }

      await supabase.rpc("mark_email_sync", {
        p_connection: c.id,
        p_error: falhouIa ? (erros.at(-1) ?? "Falha na leitura.") : null,
      });
    } catch (e) {
      const msg = e instanceof GmailError ? e.message : "Falha ao ler o Gmail.";
      erros.push(msg);
      await supabase.rpc("mark_email_sync", { p_connection: c.id, p_error: msg });
    }
  }

  if (chamadas > 0) await recordAiUsage(houseId, "secretario", { calls: chamadas, costUsd: custo, model: modelo });
  revalidatePath("/secretario");
  if (novos > 0) revalidatePath("/inicio");
  return { novos, erros };
}

const idSchema = z.string().uuid();

/** "Feito" ou "Ignorar": o item sai da lista de pendentes. */
export async function marcarEmail(input: { id: string; status: "feito" | "ignorado" | "pendente" }): Promise<{ error?: string }> {
  const id = idSchema.safeParse(input.id);
  const status = z.enum(["feito", "ignorado", "pendente"]).safeParse(input.status);
  if (!id.success || !status.success) return { error: "Item inválido." };
  const [houseId, supabase] = await Promise.all([requireHouseId(), createClient()]);
  const { error } = await supabase
    .from("email_items")
    .update({ status: status.data, updated_at: new Date().toISOString() })
    .eq("house_id", houseId)
    .eq("id", id.data);
  if (error) {
    console.error("[secretario] falha ao marcar", { code: error.code });
    return { error: "Não foi possível atualizar o e-mail." };
  }
  revalidatePath("/secretario");
  revalidatePath("/inicio");
  return {};
}

/**
 * O pedido do e-mail vira tarefa, no fim da primeira coluna do quadro. O item
 * sai dos pendentes: a tarefa passa a ser o lembrete.
 */
export async function criarTarefaDoEmail(input: { id: string }): Promise<{ error?: string }> {
  const id = idSchema.safeParse(input.id);
  if (!id.success) return { error: "Item inválido." };
  const [houseId, supabase, user] = await Promise.all([requireHouseId(), createClient(), getCurrentUser()]);

  const { data: item } = await supabase
    .from("email_items")
    .select("id, summary, subject")
    .eq("house_id", houseId)
    .eq("id", id.data)
    .maybeSingle();
  if (!item) return { error: "E-mail não encontrado." };

  const { data: listas } = await supabase
    .from("task_lists")
    .select("id")
    .eq("house_id", houseId)
    .order("position", { ascending: true })
    .limit(1);
  const lista = listas?.[0]?.id as string | undefined;
  if (!lista) return { error: "Crie o quadro em Tarefas primeiro." };

  const { data: ultimas } = await supabase
    .from("tasks")
    .select("position")
    .eq("house_id", houseId)
    .eq("list_id", lista)
    .order("position", { ascending: false })
    .limit(1);
  const position = ultimas && ultimas.length > 0 ? Number(ultimas[0]!.position) + 1 : 0;
  const titulo = String(item.summary || item.subject || "E-mail").slice(0, 200);

  const { error } = await supabase
    .from("tasks")
    .insert({ house_id: houseId, list_id: lista, title: titulo, position, created_by: user?.id ?? null });
  if (error) {
    console.error("[secretario] falha ao criar tarefa", { code: error.code });
    return { error: "Não foi possível criar a tarefa." };
  }
  await supabase.from("email_items").update({ status: "feito", updated_at: new Date().toISOString() }).eq("id", id.data);
  revalidatePath("/secretario");
  revalidatePath("/tarefas");
  revalidatePath("/inicio");
  return {};
}

export async function desconectarGmail(): Promise<{ error?: string }> {
  const [houseId, supabase] = await Promise.all([requireHouseId(), createClient()]);
  const { error } = await supabase.rpc("clear_email_connection", { p_house: houseId });
  if (error) {
    console.error("[secretario] falha ao desconectar", { code: error.code });
    return { error: "Não foi possível desconectar o Gmail." };
  }
  revalidatePath("/casa");
  revalidatePath("/secretario");
  return {};
}
