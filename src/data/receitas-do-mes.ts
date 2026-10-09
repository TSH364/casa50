import "server-only";
import { listTransactions } from "./queries";
import { addMonths } from "@/domain/month";
import { JANELA_RECEITA } from "@/domain/projecao";
import { faltamNoMes, modelosDeReceita, type ModeloDeReceita } from "@/domain/receitas-do-mes";
import type { MonthKey } from "@/domain/types";

export interface ReceitasDoMes {
  /** Todas as receitas de todo mes - o "Preencher com" do formulario. */
  modelos: ModeloDeReceita[];
  /** As que ainda nao entraram em `mes`. */
  faltam: ModeloDeReceita[];
}

/**
 * As receitas de todo mes para `mes`: so as receitas dos 3 meses antes e do
 * proprio mes. Um atalho - se a consulta falhar, a tela segue sem ele.
 */
export async function carregarReceitasDoMes(houseId: string, mes: MonthKey): Promise<ReceitasDoMes> {
  try {
    const receitas = await listTransactions(houseId, {
      type: "income",
      fromMonth: addMonths(mes, -JANELA_RECEITA),
      toMonth: mes,
    });
    const modelos = modelosDeReceita(receitas, mes);
    return { modelos, faltam: faltamNoMes(modelos, receitas, mes) };
  } catch {
    return { modelos: [], faltam: [] };
  }
}
