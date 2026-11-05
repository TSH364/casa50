import { z } from "zod";
import { comCodigo, jsonHA } from "../shared";

/**
 * POST /api/ha/energia {"kwh": 123.4, "dia": "2026-11-03"} - o consumo do
 * mes ate o dia, do "utility meter" mensal do Home Assistant. Mandar de novo
 * no mesmo dia troca o valor; sem `dia`, vale o de hoje (horario de Brasilia).
 */

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  kwh: z.coerce.number().finite().min(0).lt(100_000),
  dia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

function hojeEmBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function POST(request: Request) {
  return comCodigo(request, async (supabase, hash) => {
    const corpo = corpoSchema.safeParse(await request.json().catch(() => null));
    if (!corpo.success) return jsonHA({ error: "Mande {\"kwh\": número, \"dia\": \"AAAA-MM-DD\"}." }, 400);
    const dia = corpo.data.dia ?? hojeEmBrasilia();
    const { error } = await supabase.rpc("ha_registrar_energia", { p_hash: hash, p_dia: dia, p_kwh: corpo.data.kwh });
    if (error) throw error;
    return jsonHA({ ok: true, dia, kwh: corpo.data.kwh });
  });
}
