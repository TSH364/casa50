import { z } from "zod";
import { comCodigo, jsonHA } from "../shared";

/**
 * GET /api/ha/tarefas - as tarefas abertas do quadro, na ordem dele.
 * POST /api/ha/tarefas {"titulo": "..."} - tarefa nova no fim da primeira
 * coluna (o `rest_command.fluxo_nova_tarefa`, que a voz do Home Assistant
 * pode chamar).
 */

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return comCodigo(request, async (supabase, hash) => {
    const { data, error } = await supabase.rpc("ha_tarefas", { p_hash: hash });
    if (error) throw error;
    const tarefas = ((data ?? []) as { id: string; titulo: string; coluna: string; prazo: string | null }[]).map((t) => ({
      id: t.id,
      titulo: t.titulo,
      coluna: t.coluna,
      prazo: t.prazo,
    }));
    return jsonHA({ total: tarefas.length, tarefas });
  });
}

const nova = z.object({ titulo: z.string().trim().min(1).max(200) });

export function POST(request: Request) {
  return comCodigo(request, async (supabase, hash) => {
    const corpo = nova.safeParse(await request.json().catch(() => null));
    if (!corpo.success) return jsonHA({ error: "Mande {\"titulo\": \"...\"}, com até 200 caracteres." }, 400);
    const { data, error } = await supabase.rpc("ha_tarefa_criar", { p_hash: hash, p_titulo: corpo.data.titulo });
    if (error) throw error;
    return jsonHA({ id: data as string }, 201);
  });
}
