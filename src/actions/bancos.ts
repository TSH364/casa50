"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { fromMonthKey } from "@/data/mappers";
import { fromCents } from "@/lib/money";
import {
  loadCategoryMaps,
  loadMerchantHistory,
  resolveCategory,
  resolveSubcategoryId,
} from "@/lib/category-rules";
import { PluggyError, pluggyAccounts, pluggyAuth, pluggyTransactions } from "@/lib/pluggy";
import {
  diasDoCartao,
  ehCartaoDeCredito,
  HORAS_ENTRE_SINCRONIAS,
  inicioDaJanela,
  nomeDaConta,
  paraLancamento,
  precisaSincronizar,
  ultimosQuatro,
  type LancamentoDoBanco,
  type PluggyAccount,
} from "@/domain/pluggy";
import { casarProvisorios, janelaDasLinhas } from "@/domain/provisorios";
import { requireHouseId } from "./shared";

/**
 * Meu Pluggy: conectar os bancos de cada pessoa e trazer as compras do cartao.
 *
 * O SEGREDO ENTRA E NAO VOLTA, como a chave da IA: nenhuma acao devolve o
 * Client Secret ao navegador. A tela sabe os quatro ultimos caracteres.
 *
 * A sincronizacao roda com a sessao de quem abriu o app - nao ha robo de
 * madrugada, porque isso exigiria a chave de servico do Supabase (que ignora
 * as regras de acesso) na Vercel. Abrir o app depois de algumas horas
 * sincroniza; o botao "Sincronizar agora" forca.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

function traduzir(code: string | undefined, message: string | undefined, padrao: string): string {
  if (code === "42501") return "Só quem participa da casa conecta bancos.";
  if (code === "22023" && message) return message;
  return padrao;
}

const conexaoSchema = z.object({
  clientId: z.string().trim().regex(/^[A-Za-z0-9-]{8,80}$/, "Isto não parece um Client ID da Pluggy."),
  clientSecret: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[A-Za-z0-9_-]{8,200}$/.test(v), "Isto não parece um Client Secret da Pluggy."),
  itemIds: z.string().max(2000),
});

export interface ContaEncontrada {
  nome: string;
  tipo: "cartao" | "conta";
  final: string | null;
}

export interface SalvarConexaoResult {
  ok?: true;
  error?: string;
  contas?: ContaEncontrada[];
}

/**
 * Testa e guarda a conexao de quem esta usando o app. Testa ANTES: credencial
 * que a Pluggy recusa nao entra, para o erro aparecer agora e nao na
 * sincronizacao de amanha.
 */
export async function salvarConexaoBancaria(input: {
  clientId: string;
  clientSecret: string;
  itemIds: string;
}): Promise<SalvarConexaoResult> {
  const parsed = conexaoSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const itemIds = [...new Set(parsed.data.itemIds.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  if (itemIds.length === 0) return { error: "Informe ao menos um Item ID." };
  if (itemIds.length > 10) return { error: "No máximo 10 Item IDs." };
  if (itemIds.some((i) => !/^[A-Za-z0-9-]{8,80}$/.test(i))) {
    return { error: "Algum Item ID não está no formato da Pluggy." };
  }

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  // Segredo em branco = manter o salvo. Para testar, e preciso o salvo.
  let segredo = parsed.data.clientSecret;
  if (!segredo) {
    const { data } = await supabase.rpc("bank_connection_secrets", { p_house: houseId });
    const minha = ((data ?? []) as { member_id: string; client_secret: string }[]).find((c) => c.member_id === user?.id);
    if (!minha) return { error: "Cole o Client Secret." };
    segredo = minha.client_secret;
  }

  let contas: ContaEncontrada[];
  try {
    const apiKey = await pluggyAuth(parsed.data.clientId, segredo);
    const todas = (await Promise.all(itemIds.map((id) => pluggyAccounts(apiKey, id)))).flat();
    contas = todas.map((a) => ({
      nome: nomeDaConta(a),
      tipo: ehCartaoDeCredito(a) ? "cartao" : "conta",
      final: ultimosQuatro(a.number),
    }));
  } catch (e) {
    if (e instanceof PluggyError) return { error: e.message };
    console.error("[bancos] falha ao testar a conexao");
    return { error: "Não foi possível falar com a Pluggy agora." };
  }

  const { error } = await supabase.rpc("set_bank_connection", {
    p_house: houseId,
    p_client_id: parsed.data.clientId,
    p_client_secret: parsed.data.clientSecret,
    p_item_ids: itemIds,
  });
  if (error) {
    console.error("[bancos] falha ao guardar a conexao", { code: error.code });
    return { error: traduzir(error.code, error.message, "Não foi possível guardar a conexão.") };
  }

  revalidatePath("/casa");
  return { ok: true, contas };
}

export async function apagarConexaoBancaria(): Promise<{ ok?: true; error?: string }> {
  const houseId = await requireHouseId();
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_bank_connection", { p_house: houseId });
  if (error) {
    console.error("[bancos] falha ao apagar a conexao", { code: error.code });
    return { error: "Não foi possível desconectar." };
  }
  revalidatePath("/casa");
  return { ok: true };
}

export interface SincronizacaoResult {
  /** Nao ha conexao na casa. */
  semConexao?: true;
  /** Sincronizou ha pouco; nada feito. */
  emDia?: true;
  novos: number;
  erros: string[];
}

interface CartaoDaCasa {
  id: string;
  closingDay: number | null;
  dueDay: number | null;
}

/** O cartao da casa com este final; cria, com o nome da conta, quando nao existe. */
async function cartaoPara(
  supabase: Supabase,
  houseId: string,
  final: string | null,
  conta: PluggyAccount,
  donoId: string,
  porFinal: Map<string, CartaoDaCasa>,
): Promise<CartaoDaCasa | null> {
  if (!final) return null;
  const achado = porFinal.get(final);
  if (achado) return achado;
  const dias = diasDoCartao(conta);
  const { data, error } = await supabase
    .from("cards")
    .insert({
      house_id: houseId,
      name: nomeDaConta(conta),
      last_four: final,
      owner_id: donoId,
      closing_day: dias.closingDay,
      due_day: dias.dueDay,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[bancos] falha ao criar cartao", { code: error?.code });
    return null;
  }
  const novo = { id: data.id as string, ...dias };
  porFinal.set(final, novo);
  return novo;
}

/**
 * Traz as compras do cartao de cada conexao da casa e lanca como provisorias.
 *
 * Sem `forcar`, so as conexoes que nao sincronizam ha algumas horas - e o que
 * a abertura do app chama. A mesma compra nao entra duas vezes: nem pelo id
 * da Pluggy (a janela volta alguns dias de proposito), nem quando ja esta no
 * app por outro caminho (a fatura importada, ou o "gastei 40 na padaria" da
 * conversa) - o mesmo casamento da conciliacao decide.
 */
export async function sincronizarBancos(input: { forcar?: boolean } = {}): Promise<SincronizacaoResult> {
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();
  return sincronizar(supabase, houseId, user?.id ?? null, input.forcar ? "todas" : "vencidas");
}

/**
 * A abertura do app: le os bancos vencidos DEPOIS que a pagina foi enviada
 * (`after()` no layout), como as agendas - ninguem espera por isso.
 *
 * Reserva antes de ler (`claim_bank_sync`): duas abas abertas, ou as duas
 * pessoas abrindo o app juntas, nao leem o mesmo banco duas vezes. Falha em
 * silencio de proposito - nao ha tela onde mostrar; o motivo fica em
 * `last_error`, visivel na Casa.
 */
export async function syncStaleBanks(): Promise<void> {
  try {
    const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("claim_bank_sync", {
      p_house: houseId,
      p_hours: HORAS_ENTRE_SINCRONIAS,
    });
    if (error || !data || (data as string[]).length === 0) return;
    await sincronizar(supabase, houseId, user?.id ?? null, new Set(data as string[]));
  } catch (e) {
    console.error("[bancos] sincronizacao automatica falhou", { message: e instanceof Error ? e.message : "?" });
  }
}

async function sincronizar(
  supabase: Supabase,
  houseId: string,
  userId: string | null,
  quais: "todas" | "vencidas" | Set<string>,
): Promise<SincronizacaoResult> {

  const { data: conexoesRaw, error: conexoesError } = await supabase.rpc("bank_connection_secrets", {
    p_house: houseId,
  });
  if (conexoesError) {
    console.error("[bancos] falha ao ler conexoes", { code: conexoesError.code });
    return { novos: 0, erros: ["Não foi possível ler as conexões."] };
  }
  const conexoes = (conexoesRaw ?? []) as {
    id: string;
    member_id: string;
    client_id: string;
    client_secret: string;
    item_ids: string[];
    last_sync_at: string | null;
  }[];
  if (conexoes.length === 0) return { semConexao: true, novos: 0, erros: [] };

  const agora = new Date();
  const devidas =
    quais === "todas"
      ? conexoes
      : quais === "vencidas"
        ? conexoes.filter((c) => precisaSincronizar(c.last_sync_at, agora))
        : conexoes.filter((c) => quais.has(c.id));
  if (devidas.length === 0) return { emDia: true, novos: 0, erros: [] };

  const { data: cartoes } = await supabase
    .from("cards")
    .select("id, last_four, closing_day, due_day")
    .eq("house_id", houseId);
  const porFinal = new Map<string, CartaoDaCasa>();
  for (const c of cartoes ?? []) {
    const final = c.last_four as string | null;
    if (final && !porFinal.has(final)) {
      porFinal.set(final, {
        id: c.id as string,
        closingDay: (c.closing_day as number | null) ?? null,
        dueDay: (c.due_day as number | null) ?? null,
      });
    }
  }

  const hoje = agora.toISOString().slice(0, 10);
  const lidos: (LancamentoDoBanco & { cardId: string | null })[] = [];
  const erros: string[] = [];
  const ok: string[] = [];

  for (const c of devidas) {
    try {
      const apiKey = await pluggyAuth(c.client_id, c.client_secret);
      for (const itemId of c.item_ids) {
        const contas = (await pluggyAccounts(apiKey, itemId)).filter(ehCartaoDeCredito);
        for (const conta of contas) {
          const txs = await pluggyTransactions(apiKey, conta.id, inicioDaJanela(c.last_sync_at, agora), hoje);
          for (const tx of txs) {
            const final = ultimosQuatro(tx.creditCardMetadata?.cardNumber) ?? ultimosQuatro(conta.number);
            const cartao = await cartaoPara(supabase, houseId, final, conta, c.member_id, porFinal);
            const dias = cartao?.closingDay ? cartao : diasDoCartao(conta);
            const l = paraLancamento(tx, conta, dias);
            if (l) lidos.push({ ...l, cardId: cartao?.id ?? null });
          }
        }
      }
      ok.push(c.id);
    } catch (e) {
      const msg = e instanceof PluggyError ? e.message : "Falha ao ler o banco.";
      erros.push(msg);
      await supabase.rpc("mark_bank_sync", { p_connection: c.id, p_error: msg });
    }
  }

  const novos = await gravar(supabase, houseId, userId, lidos);
  if (novos.error) {
    erros.push(novos.error);
  } else {
    for (const id of ok) await supabase.rpc("mark_bank_sync", { p_connection: id, p_error: null });
  }

  if (novos.count > 0) {
    revalidatePath("/inicio");
    revalidatePath("/extratos");
    revalidatePath("/analise");
  }
  revalidatePath("/casa");
  return { novos: novos.count, erros };
}

const LOTE = 200;

async function gravar(
  supabase: Supabase,
  houseId: string,
  userId: string | null,
  lidos: (LancamentoDoBanco & { cardId: string | null })[],
): Promise<{ count: number; error?: string }> {
  if (lidos.length === 0) return { count: 0 };

  // 1. O que ja entrou por esta mesma sincronizacao (a janela se sobrepoe).
  const vistos = new Set<string>();
  const unicos = lidos.filter((l) => (vistos.has(l.externalId) ? false : (vistos.add(l.externalId), true)));
  const jaGravados = new Set<string>();
  for (let i = 0; i < unicos.length; i += LOTE) {
    const ids = unicos.slice(i, i + LOTE).map((l) => l.externalId);
    const { data, error } = await supabase
      .from("transactions")
      .select("external_id")
      .eq("house_id", houseId)
      .in("external_id", ids);
    if (error) return { count: 0, error: "Não foi possível conferir o que já foi sincronizado." };
    for (const t of data ?? []) jaGravados.add(t.external_id as string);
  }
  const candidatos = unicos.filter((l) => !jaGravados.has(l.externalId));
  if (candidatos.length === 0) return { count: 0 };

  // 2. O que ja esta no app por outro caminho: fatura importada, lancamento a mao.
  const janela = janelaDasLinhas(candidatos.map((l) => l.date))!;
  const { data: existentes, error: existentesError } = await supabase
    .from("transactions")
    .select("id, date, amount, type, card_id, description, merchant_alias, installment_current, installment_total")
    .eq("house_id", houseId)
    .is("external_id", null)
    .eq("status", "confirmed")
    .gte("date", janela.de)
    .lte("date", janela.ate);
  if (existentesError) return { count: 0, error: "Não foi possível conferir os lançamentos do mês." };
  const casados = casarProvisorios(
    candidatos.map((l) => ({
      chave: l.externalId,
      date: l.date,
      amountCents: l.amountCents,
      type: l.type,
      cardId: l.cardId,
      merchantNormalized: l.merchantNormalized,
      installmentCurrent: l.installmentCurrent,
      installmentTotal: l.installmentTotal,
    })),
    (existentes ?? []).map((t) => ({
      id: t.id as string,
      date: String(t.date).slice(0, 10),
      amountCents: Math.round(Number(t.amount) * 100),
      type: t.type as string,
      cardId: (t.card_id as string | null) ?? null,
      texto: (t.merchant_alias as string | null) || String(t.description ?? ""),
      installmentCurrent: (t.installment_current as number | null) ?? null,
      installmentTotal: (t.installment_total as number | null) ?? null,
    })),
  );
  const novos = candidatos.filter((l) => !casados.has(l.externalId));
  if (novos.length === 0) return { count: 0 };

  const [maps, historico] = await Promise.all([
    loadCategoryMaps(supabase, houseId),
    loadMerchantHistory(supabase, houseId),
  ]);

  const rows = novos.map((l) => {
    const cat = resolveCategory(
      { merchantNormalized: l.merchantNormalized, categoryHint: null, type: l.type },
      maps,
      historico,
    );
    return {
      house_id: houseId,
      card_id: l.cardId,
      member_id: null,
      date: l.date,
      invoice_month: fromMonthKey(l.invoiceMonth),
      description: l.description,
      merchant_original: l.merchantOriginal,
      merchant_normalized: l.merchantNormalized,
      card_last_four: l.cardLastFour,
      amount: fromCents(l.amountCents),
      type: l.type,
      // Provisorio ate a fatura chegar: a conciliacao poe a linha da fatura no lugar.
      origin: "imported_statement" as const,
      status: "confirmed" as const,
      category_id: cat.id,
      category_source: cat.id === null ? null : cat.source,
      subcategory_id: resolveSubcategoryId(l.merchantNormalized, cat.id, maps),
      visibility: "shared" as const,
      installment_current: l.installmentCurrent,
      installment_total: l.installmentTotal,
      installment_value: l.installmentTotal === null ? null : fromCents(l.amountCents),
      external_id: l.externalId,
      created_by: userId,
    };
  });

  const { error } = await supabase.from("transactions").insert(rows);
  if (error) {
    // Outro aparelho da casa sincronizou no mesmo instante: o que ele gravou
    // e o mesmo que este gravaria.
    if (error.code === "23505") return { count: 0 };
    console.error("[bancos] falha ao gravar", { code: error.code });
    return { count: 0, error: "Não foi possível gravar as compras do banco." };
  }
  return { count: rows.length };
}
