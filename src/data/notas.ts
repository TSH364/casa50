import "server-only";
import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { GmailError, lerPlanilha } from "@/lib/gmail";
import { listTransactions } from "./queries";
import { tabelaAusente } from "./radar";
import { addMonths, monthOf } from "@/domain/month";
import { casarNotas, lerNotas, type NotaResumo } from "@/domain/notas";
import { fromCents } from "@/lib/money";

/**
 * Notas fiscais: ler a planilha de uma conexao, guardar as notas e casar com
 * as compras. Fica fora de `actions/` de proposito: recebe o cliente do banco
 * e a casa de quem chama, e nao pode virar acao chamavel do navegador.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Quantos dias para tras o casamento procura compra para nota sem par. */
const DIAS_PARA_CASAR = 180;

/** As planilhas ligadas, por conexao. Sem a migracao das notas, nenhuma. */
export async function planilhasDaCasa(supabase: Supabase, houseId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("email_connections").select("id, nf_sheet_id").eq("house_id", houseId);
  if (error) {
    // 42703: a coluna ainda nao existe (migracao das notas nao aplicada).
    if (error.code !== "42703" && !tabelaAusente(error.code)) console.error("[notas] falha ao ler planilhas", { code: error.code });
    return new Map();
  }
  return new Map(
    (data ?? []).filter((c) => c.nf_sheet_id).map((c) => [c.id as string, c.nf_sheet_id as string]),
  );
}

/**
 * Le a planilha de uma conexao e guarda as notas (atualizando as que ja
 * estavam - o Gemini pode completar o valor depois). Devolve quantas linhas
 * leu. Nao casa: quem chama casa uma vez, depois de todas as planilhas.
 */
export async function sincronizarPlanilha(
  supabase: Supabase,
  houseId: string,
  conexaoId: string,
  planilhaId: string,
  token: string,
): Promise<number> {
  const notas = lerNotas(await lerPlanilha(token, planilhaId));
  for (let i = 0; i < notas.length; i += 200) {
    const linhas = notas.slice(i, i + 200).map((n) => ({
      house_id: houseId,
      connection_id: conexaoId,
      chave: n.chave,
      data: n.data,
      categoria: n.categoria,
      loja: n.loja,
      cnpj: n.cnpj,
      produto: n.produto,
      valor: n.valorCents === null ? null : fromCents(n.valorCents),
      quem: n.quem,
      pagamento: n.pagamento,
      numero: n.numero,
      pedido: n.pedido,
      chave_acesso: n.chaveAcesso,
      link_email: n.linkEmail,
      sem_compra: n.semCompra,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("nf_notas").upsert(linhas, { onConflict: "house_id,chave" });
    if (error) {
      console.error("[notas] falha ao gravar", { code: error.code });
      throw new GmailError(
        tabelaAusente(error.code) ? "Falta aplicar a atualização do banco das notas fiscais." : "Não foi possível guardar as notas.",
      );
    }
  }
  await supabase.rpc("mark_nf_sync", { p_connection: conexaoId, p_error: null });
  return notas.length;
}

/** Liga as notas ainda sem compra as compras da fatura. Devolve quantas ligou. */
export async function casarPendentes(supabase: Supabase, houseId: string): Promise<number> {
  const desde = new Date(Date.now() - DIAS_PARA_CASAR * 86_400_000).toISOString().slice(0, 10);
  const { data: pendentes, error } = await supabase
    .from("nf_notas")
    .select("id, chave, data, loja, valor, sem_compra")
    .eq("house_id", houseId)
    .is("transaction_id", null)
    .eq("sem_compra", false)
    .gte("data", desde);
  if (error || !pendentes || pendentes.length === 0) return 0;

  const { data: ligadas } = await supabase
    .from("nf_notas")
    .select("transaction_id")
    .eq("house_id", houseId)
    .not("transaction_id", "is", null);
  const jaLigadas = new Set((ligadas ?? []).map((l) => l.transaction_id as string));

  const datas = pendentes.map((p) => String(p.data).slice(0, 10)).sort();
  const compras = await listTransactions(houseId, {
    fromMonth: addMonths(monthOf(datas[0]!), -1),
    toMonth: addMonths(monthOf(datas.at(-1)!), 2),
    limit: 5000,
  });
  const notas = pendentes.map((p) => ({
    chave: p.chave as string,
    data: String(p.data).slice(0, 10),
    loja: p.loja as string,
    valorCents: p.valor === null || p.valor === undefined ? null : Math.round(Number(p.valor) * 100),
    semCompra: Boolean(p.sem_compra),
  }));
  const pares = casarNotas(notas, compras, jaLigadas);
  const idDaChave = new Map(pendentes.map((p) => [p.chave as string, p.id as string]));
  let feitas = 0;
  for (const [chave, transacao] of pares) {
    const { error: upError } = await supabase
      .from("nf_notas")
      .update({ transaction_id: transacao, updated_at: new Date().toISOString() })
      .eq("house_id", houseId)
      .eq("id", idDaChave.get(chave)!)
      .is("transaction_id", null);
    if (!upError) feitas += 1;
  }
  if (feitas > 0) revalidatePath("/extratos");
  return feitas;
}

/**
 * As notas ligadas a estas compras, por compra. Antes da migracao das notas,
 * nenhuma - a lista de lancamentos segue igual.
 */
export async function notasDasCompras(
  supabase: Supabase,
  houseId: string,
  transactionIds: readonly string[],
): Promise<Record<string, NotaResumo[]>> {
  const porCompra: Record<string, NotaResumo[]> = {};
  for (let i = 0; i < transactionIds.length; i += 200) {
    const ids = transactionIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("nf_notas")
      .select("transaction_id, produto, numero, loja, link_email")
      .eq("house_id", houseId)
      .in("transaction_id", ids);
    if (error) {
      if (!tabelaAusente(error.code)) console.error("[notas] falha ao ler notas das compras", { code: error.code });
      return {};
    }
    for (const n of data ?? []) {
      const id = n.transaction_id as string;
      (porCompra[id] ??= []).push({
        produto: n.produto as string,
        numero: (n.numero as string | null) ?? null,
        loja: n.loja as string,
        linkEmail: (n.link_email as string | null) ?? null,
      });
    }
  }
  return porCompra;
}

/** As compras cuja nota fala de `termo` ("forno" acha a linha "MERCADOLIVRE"). */
export async function comprasPeloProduto(supabase: Supabase, houseId: string, termo: string): Promise<Set<string>> {
  // Mesmo cuidado da busca de Extratos: virgula e parentese sao sintaxe do PostgREST.
  const t = termo.trim().replace(/[,()%_]/g, " ").trim();
  if (t.length < 3) return new Set();
  const { data, error } = await supabase
    .from("nf_notas")
    .select("transaction_id")
    .eq("house_id", houseId)
    .not("transaction_id", "is", null)
    .ilike("produto", `%${t}%`)
    .limit(200);
  if (error) return new Set();
  return new Set((data ?? []).map((n) => n.transaction_id as string));
}

export interface EstadoDasNotas {
  /** Por conexao: a planilha ligada e a ultima leitura. */
  planilhas: Record<string, { sheetId: string | null; lastSyncAt: string | null; lastError: string | null }>;
  total: number;
  ligadas: number;
}

/** Para a Casa. `null` antes da migracao das notas. */
export async function estadoDasNotas(supabase: Supabase, houseId: string): Promise<EstadoDasNotas | null> {
  const { data, error } = await supabase
    .from("email_connections")
    .select("id, nf_sheet_id, nf_last_sync_at, nf_last_error")
    .eq("house_id", houseId);
  if (error) return null;
  const [total, ligadas] = await Promise.all([
    supabase.from("nf_notas").select("id", { count: "exact", head: true }).eq("house_id", houseId),
    supabase.from("nf_notas").select("id", { count: "exact", head: true }).eq("house_id", houseId).not("transaction_id", "is", null),
  ]);
  if (total.error) return null;
  return {
    planilhas: Object.fromEntries(
      (data ?? []).map((c) => [
        c.id as string,
        {
          sheetId: (c.nf_sheet_id as string | null) ?? null,
          lastSyncAt: (c.nf_last_sync_at as string | null) ?? null,
          lastError: (c.nf_last_error as string | null) ?? null,
        },
      ]),
    ),
    total: total.count ?? 0,
    ligadas: ligadas.count ?? 0,
  };
}
