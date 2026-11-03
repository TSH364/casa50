import { z } from "zod";
import { comCodigo, jsonHA } from "../../shared";

/** POST /api/ha/tarefas/concluir {"id": "..."} - marca a tarefa como feita. */

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ id: z.string().uuid() });

export function POST(request: Request) {
  return comCodigo(request, async (supabase, hash) => {
    const corpo = corpoSchema.safeParse(await request.json().catch(() => null));
    if (!corpo.success) return jsonHA({ error: "Mande {\"id\": \"...\"} de uma tarefa." }, 400);
    const { data, error } = await supabase.rpc("ha_tarefa_concluir", { p_hash: hash, p_id: corpo.data.id });
    if (error) throw error;
    // `false`: a tarefa nao e desta casa, nao existe, ou ja estava feita.
    return data ? jsonHA({ ok: true }) : jsonHA({ error: "Tarefa não encontrada ou já feita." }, 404);
  });
}
