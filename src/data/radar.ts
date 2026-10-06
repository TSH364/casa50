import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { RadarPreco, RadarProduto } from "@/domain/radar";

/**
 * O Radar como a tela o le: os produtos e, de cada um, as ultimas
 * conferencias (do mais novo para o mais antigo).
 *
 * `disponivel: false` quando as tabelas ainda nao existem - o codigo pode
 * subir antes da migracao (ver CLAUDE.md), e a tela entao explica em vez de
 * cair.
 */
export interface RadarDados {
  disponivel: boolean;
  itens: { produto: RadarProduto; historico: RadarPreco[] }[];
}

/** Tabela que nao existe: 42P01 no Postgres, PGRST205 no PostgREST. */
export function tabelaAusente(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST205";
}

export function mapProduto(r: Record<string, unknown>): RadarProduto {
  const cents = r.best_cents === null || r.best_cents === undefined ? null : Number(r.best_cents);
  return {
    id: String(r.id),
    nome: String(r.name),
    metaCents: r.target_cents === null || r.target_cents === undefined ? null : Number(r.target_cents),
    ativo: r.is_active !== false,
    conferidoEm: (r.last_checked_at as string | null) ?? null,
    erro: (r.last_error as string | null) ?? null,
    melhor:
      cents !== null && r.best_url
        ? {
            cents,
            loja: String(r.best_store ?? ""),
            url: String(r.best_url),
            titulo: (r.best_title as string | null) ?? null,
          }
        : null,
  };
}

function mapPreco(r: Record<string, unknown>): RadarPreco {
  return {
    em: String(r.checked_at),
    cents: Number(r.price_cents),
    loja: String(r.store),
    url: String(r.url),
    titulo: (r.title as string | null) ?? null,
    vistoNaPagina: r.price_seen === true,
  };
}

export async function carregarRadar(houseId: string, porProduto = 30): Promise<RadarDados> {
  const supabase = await createClient();
  const { data: produtos, error } = await supabase
    .from("radar_products")
    .select("*")
    .eq("house_id", houseId)
    .order("created_at", { ascending: false });
  if (error) {
    if (tabelaAusente(error.code)) return { disponivel: false, itens: [] };
    console.error("[radar] falha ao ler produtos", { code: error.code });
    return { disponivel: true, itens: [] };
  }
  const lista = (produtos ?? []) as Record<string, unknown>[];
  if (lista.length === 0) return { disponivel: true, itens: [] };

  const ids = lista.map((p) => String(p.id));
  const { data: precos, error: erroPrecos } = await supabase
    .from("radar_prices")
    .select("product_id, checked_at, price_cents, store, url, title, price_seen")
    .eq("house_id", houseId)
    .in("product_id", ids)
    .order("checked_at", { ascending: false })
    .limit(ids.length * porProduto);
  if (erroPrecos) console.error("[radar] falha ao ler historico", { code: erroPrecos.code });

  const porId = new Map<string, RadarPreco[]>();
  for (const r of (precos ?? []) as Record<string, unknown>[]) {
    const id = String(r.product_id);
    const h = porId.get(id) ?? [];
    if (h.length < porProduto) h.push(mapPreco(r));
    porId.set(id, h);
  }
  return {
    disponivel: true,
    itens: lista.map((r) => ({ produto: mapProduto(r), historico: porId.get(String(r.id)) ?? [] })),
  };
}
