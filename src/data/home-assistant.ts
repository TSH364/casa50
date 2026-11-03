import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listBudgets, listGoals, listRecurrences, listTransactions } from "@/data/queries";
import { carregarSecretario } from "@/data/secretario";
import { houseView } from "@/lib/house-view";
import { tabelaAusente } from "@/data/radar";
import { addMonths, currentMonth } from "@/domain/month";
import { montarResumoHA, type ResumoHA } from "@/domain/home-assistant";
import type { IsoDate } from "@/domain/types";

/**
 * O Home Assistant do lado do app (com sessao): o estado na tela da Casa, as
 * leituras de energia e o resumo que o app grava para ele ler.
 */

export interface EstadoHA {
  /** `false` enquanto a migracao nao foi aplicada. */
  disponivel: boolean;
  ativo: boolean;
  criadoEm: string | null;
  ultimoAcessoEm: string | null;
  resumoEm: string | null;
  tarifaKwh: number | null;
}

export async function estadoHA(houseId: string): Promise<EstadoHA> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ha_integracoes")
    .select("criado_em, ultimo_acesso_em, resumo_em, tarifa_kwh")
    .eq("house_id", houseId)
    .maybeSingle();
  const vazio = { ativo: false, criadoEm: null, ultimoAcessoEm: null, resumoEm: null, tarifaKwh: null };
  if (error) {
    if (!tabelaAusente(error.code)) console.error("[home-assistant] falha ao ler o estado", { code: error.code });
    return { disponivel: !tabelaAusente(error.code), ...vazio };
  }
  if (!data) return { disponivel: true, ...vazio };
  return {
    disponivel: true,
    ativo: true,
    criadoEm: data.criado_em as string,
    ultimoAcessoEm: (data.ultimo_acesso_em as string | null) ?? null,
    resumoEm: (data.resumo_em as string | null) ?? null,
    tarifaKwh: data.tarifa_kwh === null ? null : Number(data.tarifa_kwh),
  };
}

/** As leituras de energia dos ultimos dois meses e pouco. Sem tabela, nenhuma. */
export async function leiturasDeEnergia(houseId: string): Promise<{ dia: IsoDate; kwhMes: number }[]> {
  const supabase = await createClient();
  const desde = new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("energia_leituras")
    .select("dia, kwh_mes")
    .eq("house_id", houseId)
    .gte("dia", desde)
    .order("dia");
  if (error) {
    if (!tabelaAusente(error.code)) console.error("[home-assistant] falha ao ler a energia", { code: error.code });
    return [];
  }
  return (data ?? []).map((l) => ({ dia: String(l.dia).slice(0, 10) as IsoDate, kwhMes: Number(l.kwh_mes) }));
}

/** O resumo do mes corrente, com os totais da casa (sem as categorias fora dos totais). */
export async function calcularResumoHA(houseId: string, agora = new Date()): Promise<ResumoHA> {
  const mes = currentMonth(agora);
  const view = await houseView(houseId);
  const [transacoes, recorrentes, orcamentos, { goals }, secretario] = await Promise.all([
    listTransactions(houseId, {
      fromMonth: addMonths(mes, -3),
      toMonth: mes,
      excludeCategoryIds: view.excludeCategoryIds,
      limit: 5000,
    }),
    listRecurrences(houseId),
    listBudgets(houseId, mes),
    listGoals(houseId),
    carregarSecretario(houseId, 60).catch(() => ({ disponivel: false, conexoes: [], pendentes: [] })),
  ]);
  return montarResumoHA({
    mes,
    transacoes,
    recorrentes,
    orcamentos,
    metas: goals,
    categorias: view.categories,
    contasDoEmail: secretario.pendentes
      .filter((p) => p.tipo === "conta")
      .map((p) => ({ resumo: p.resumo, amountCents: p.amountCents, dueDate: p.dueDate })),
    agora,
  });
}
