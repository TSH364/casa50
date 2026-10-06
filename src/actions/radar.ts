"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getAiKey } from "@/lib/ai-config";
import { recordAiUsage } from "@/lib/ai-usage";
import { buscarOfertas } from "@/lib/ofertas";
import { buscarImagemDoProduto } from "@/lib/imagem-produto";
import { parseAmountCents } from "@/lib/money";
import { tabelaAusente } from "@/data/radar";
import { HORAS_ENTRE_CONFERENCIAS, MAX_POR_RODADA, melhorOferta, normalizarNome } from "@/domain/radar";
import { requireHouseId } from "./shared";

/**
 * Radar de produtos: cadastrar, conferir e tirar do radar.
 *
 * A conferencia roda com a sessao de quem abriu o app, como o Meu Pluggy: nao
 * ha robo de madrugada (exigiria a chave de servico do Supabase na Vercel).
 * Abrir o app confere o que esta vencido; "Conferir agora" forca um produto.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const AINDA_NAO = "O Radar ainda está sendo instalado no banco. Tente de novo em alguns minutos.";

export interface RadarResult {
  ok?: true;
  error?: string;
  /** O que a conferencia achou, para o aviso na tela. */
  achou?: { cents: number; loja: string } | null;
}

function revalidar() {
  revalidatePath("/radar");
  revalidatePath("/inicio");
}

const produtoSchema = z.object({
  nome: z
    .string()
    .transform(normalizarNome)
    .pipe(z.string().min(3, "Diga qual é o produto.").max(120, "No máximo 120 caracteres.")),
  meta: z.string().max(30).optional(),
});

function metaDe(texto: string | undefined): number | null | "invalida" {
  if (!texto || texto.trim() === "") return null;
  const cents = parseAmountCents(texto);
  return cents !== null && cents > 0 ? cents : "invalida";
}

export async function adicionarAoRadar(input: { nome: string; meta?: string }): Promise<RadarResult> {
  const parsed = produtoSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Produto inválido." };
  const meta = metaDe(parsed.data.meta);
  if (meta === "invalida") return { error: "A meta precisa ser um valor em reais, como 399,90." };

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("radar_products")
    .insert({
      house_id: houseId,
      name: parsed.data.nome,
      target_cents: meta,
      created_by: user?.id ?? null,
      check_started_at: new Date().toISOString(),
    })
    .select("id, name")
    .single();
  if (error || !data) {
    if (tabelaAusente(error?.code)) return { error: AINDA_NAO };
    console.error("[radar] falha ao cadastrar", { code: error?.code });
    return { error: "Não foi possível pôr o produto no radar." };
  }
  // Primeira conferencia ja: a casa quer ver o preco de hoje agora.
  const r = await conferir(supabase, houseId, { id: String(data.id), nome: String(data.name) });
  revalidar();
  return r;
}

export async function definirMeta(input: { id: string; meta: string }): Promise<RadarResult> {
  const id = z.string().uuid().safeParse(input.id);
  if (!id.success) return { error: "Produto inválido." };
  const meta = metaDe(input.meta);
  if (meta === "invalida") return { error: "A meta precisa ser um valor em reais, como 399,90." };
  const supabase = await createClient();
  const { error } = await supabase.from("radar_products").update({ target_cents: meta }).eq("id", id.data);
  if (error) {
    console.error("[radar] falha ao mudar a meta", { code: error.code });
    return { error: "Não foi possível mudar a meta." };
  }
  revalidar();
  return { ok: true };
}

export async function removerDoRadar(id: string): Promise<RadarResult> {
  if (!z.string().uuid().safeParse(id).success) return { error: "Produto inválido." };
  const supabase = await createClient();
  const { error } = await supabase.from("radar_products").delete().eq("id", id);
  if (error) {
    console.error("[radar] falha ao remover", { code: error.code });
    return { error: "Não foi possível tirar do radar." };
  }
  revalidar();
  return { ok: true };
}

export async function conferirAgora(id: string): Promise<RadarResult> {
  if (!z.string().uuid().safeParse(id).success) return { error: "Produto inválido." };
  const houseId = await requireHouseId();
  const supabase = await createClient();
  const travado = new Date(Date.now() - 10 * 60_000).toISOString();
  // Reserva: outra aba conferindo o mesmo produto agora nao paga duas buscas.
  const { data } = await supabase
    .from("radar_products")
    .update({ check_started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("house_id", houseId)
    .or(`check_started_at.is.null,check_started_at.lt.${travado}`)
    .select("id, name")
    .maybeSingle();
  if (!data) return { error: "Este produto já está sendo conferido. Espere um pouco." };
  const r = await conferir(supabase, houseId, { id: String(data.id), nome: String(data.name) });
  revalidar();
  return r;
}

/**
 * A abertura do app: confere o que esta vencido, no maximo `MAX_POR_RODADA`
 * por vez e em paralelo. Nunca derruba a tela - roda em `after()`.
 */
export async function syncRadar(): Promise<void> {
  try {
    const houseId = await requireHouseId();
    const supabase = await createClient();
    const agora = Date.now();
    const limite = new Date(agora - HORAS_ENTRE_CONFERENCIAS * 3_600_000).toISOString();
    const travado = new Date(agora - 10 * 60_000).toISOString();
    const { data: vencidos, error } = await supabase
      .from("radar_products")
      .select("id, name")
      .eq("house_id", houseId)
      .eq("is_active", true)
      .or(`last_checked_at.is.null,last_checked_at.lt.${limite}`)
      .or(`check_started_at.is.null,check_started_at.lt.${travado}`)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(MAX_POR_RODADA);
    if (error || !vencidos || vencidos.length === 0) return;

    const reservados: { id: string; nome: string }[] = [];
    for (const v of vencidos) {
      // A reserva e linha a linha e com o mesmo filtro: quem chegar depois
      // (a outra pessoa abrindo o app no mesmo minuto) nao recebe a linha.
      const { data } = await supabase
        .from("radar_products")
        .update({ check_started_at: new Date().toISOString() })
        .eq("id", String(v.id))
        .or(`last_checked_at.is.null,last_checked_at.lt.${limite}`)
        .or(`check_started_at.is.null,check_started_at.lt.${travado}`)
        .select("id, name")
        .maybeSingle();
      if (data) reservados.push({ id: String(data.id), nome: String(data.name) });
    }
    await Promise.all(reservados.map((p) => conferir(supabase, houseId, p)));
  } catch (e) {
    console.error("[radar] conferencia automatica falhou", { message: e instanceof Error ? e.message : "?" });
  }
}

/** Uma conferencia: busca, escolhe a melhor oferta, grava. Sempre solta a reserva. */
async function conferir(supabase: Supabase, houseId: string, produto: { id: string; nome: string }): Promise<RadarResult> {
  const agora = new Date().toISOString();
  const fechar = (campos: Record<string, unknown>) =>
    supabase
      .from("radar_products")
      .update({ check_started_at: null, last_checked_at: agora, ...campos })
      .eq("id", produto.id);

  const apiKey = await getAiKey(houseId);
  if (!apiKey) {
    await fechar({ last_error: "Sem chave de IA: cadastre a chave do OpenRouter em Casa." });
    return { error: "O Radar usa a chave de IA da casa. Cadastre-a em Casa." };
  }

  let custo = 0;
  let modelo: string | null = null;
  let detalhes: Record<string, unknown> | null = null;
  try {
    // So anuncio conferido: preco de "busca na loja" nao vira historico.
    const busca = await buscarOfertas(produto.nome, null, { apiKey, timeoutMs: 25_000, aceitarNaoConferidas: false });
    custo = busca.costUsd;
    modelo = busca.model;
    detalhes = busca.details;
    const melhor = melhorOferta(busca.offers);
    if (!melhor) {
      await fechar({ last_error: "A busca de hoje não achou anúncio com preço. Tente descrever o produto de outro jeito." });
      return { ok: true, achou: null };
    }
    const { error } = await supabase.from("radar_prices").insert({
      house_id: houseId,
      product_id: produto.id,
      checked_at: agora,
      price_cents: melhor.priceCents,
      store: melhor.store,
      url: melhor.url,
      title: melhor.title,
      price_seen: melhor.priceSeen,
    });
    if (error) console.error("[radar] falha ao gravar o preco", { code: error.code });
    await fechar({
      last_error: null,
      best_cents: melhor.priceCents,
      best_store: melhor.store,
      best_url: melhor.url,
      best_title: melhor.title,
    });
    await guardarImagem(supabase, produto.id, [melhor.url, ...busca.offers.map((o) => o.url)]);
    return { ok: true, achou: { cents: melhor.priceCents, loja: melhor.store } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "A busca falhou.";
    await fechar({ last_error: msg.slice(0, 300) });
    return { error: msg };
  } finally {
    if (custo > 0 || detalhes) await recordAiUsage(houseId, "radar", { calls: 1, costUsd: custo, model: modelo, details: detalhes });
  }
}

/**
 * A foto do produto, da pagina do anuncio. Tenta a melhor oferta e, se a loja
 * bloquear, mais uma. Gravada a parte e sem custo de IA: sem a
 * coluna (migracao ainda nao aplicada) ou sem imagem, so fica sem foto.
 */
async function guardarImagem(supabase: Supabase, produtoId: string, urls: readonly string[]): Promise<void> {
  const unicas = [...new Set(urls)].slice(0, 2);
  for (const url of unicas) {
    const imagem = await buscarImagemDoProduto(url);
    if (!imagem) continue;
    const { error } = await supabase.from("radar_products").update({ image_url: imagem }).eq("id", produtoId);
    if (error && !error.code?.startsWith("PGRST2") && error.code !== "42703") {
      console.error("[radar] falha ao guardar a imagem", { code: error.code });
    }
    return;
  }
}
