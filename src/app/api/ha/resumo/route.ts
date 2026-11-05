import { respostaParaHA, type ResumoHA } from "@/domain/home-assistant";
import type { IsoDate } from "@/domain/types";
import { comCodigo, jsonHA } from "../shared";

/**
 * GET /api/ha/resumo - os sensores do Fluxo no Home Assistant (ver o YAML em
 * `configuracaoHA`). So numeros agregados do mes: nada de lancamento, loja
 * ou e-mail.
 */

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return comCodigo(request, async (supabase, hash) => {
    const { data, error } = await supabase.rpc("ha_ler_resumo", { p_hash: hash });
    if (error) throw error;
    const d = (data ?? {}) as {
      resumo?: ResumoHA | null;
      resumo_em?: string | null;
      tarifa_kwh?: number | string | null;
      energia?: { dia: string; kwh_mes: number | string }[];
    };
    return jsonHA(
      respostaParaHA(
        {
          resumo: d.resumo ?? null,
          resumoEm: d.resumo_em ?? null,
          tarifaKwh: d.tarifa_kwh === null || d.tarifa_kwh === undefined ? null : Number(d.tarifa_kwh),
          energia: (d.energia ?? []).map((l) => ({ dia: String(l.dia).slice(0, 10) as IsoDate, kwhMes: Number(l.kwh_mes) })),
        },
        new Date(),
      ),
    );
  });
}
