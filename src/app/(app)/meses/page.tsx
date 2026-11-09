import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse } from "@/lib/houses";
import { houseView } from "@/lib/house-view";
import { listRecurrences, listTransactions } from "@/data/queries";
import { addMonths, currentMonth, monthLabel } from "@/domain/month";
import { detalharMeses } from "@/domain/meses";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { GraficoDosMeses, type ColunaDoMes } from "@/components/meses/grafico-dos-meses";
import { ListaDoMes } from "@/components/meses/lista-do-mes";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Mês a mês · Fluxo" };

/** Meses antes e depois do atual. Oito adiante mostram as parcelas terminando. */
const PASSADOS = 3;
const FUTUROS = 8;

/**
 * Mes a mes: o grafico do que entra e sai em cada mes, e a lista de cada um.
 *
 * A conta e a mesma da Projecao da Analise (`projetar`), aberta em linhas por
 * `detalharMeses`: os meses que passaram com os lancamentos, os que vem com
 * as parcelas que vao cair, as contas fixas e a media do dia a dia.
 */
export default async function MesesPage() {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const mes = currentMonth();
  const view = await houseView(active.id);
  const [transactions, futuras, recurrences] = await Promise.all([
    // Doze meses para tras, como a Analise: as parcelas longas precisam do
    // mes em que comecaram, e as receitas de todo mes, de sequencia.
    listTransactions(active.id, {
      fromMonth: addMonths(mes, -12),
      toMonth: mes,
      excludeCategoryIds: view.excludeCategoryIds,
      limit: 5000,
    }),
    // Receitas lancadas com data futura entram no mes delas.
    listTransactions(active.id, {
      fromMonth: addMonths(mes, 1),
      toMonth: addMonths(mes, FUTUROS),
      excludeCategoryIds: view.excludeCategoryIds,
      limit: 1000,
    }),
    listRecurrences(active.id),
  ]);

  if (transactions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-titulo font-semibold tracking-tight text-ink">Mês a mês</h1>
        <EmptyState title="Ainda não há lançamentos" description="Importe uma fatura para ver o que entra e sai em cada mês." />
      </div>
    );
  }

  const meses = detalharMeses({
    transactions,
    futuras,
    recurrences,
    categorias: view.categories,
    mesAtual: mes,
    passados: PASSADOS,
    futuros: FUTUROS,
  });
  const colunas: ColunaDoMes[] = meses.map((m) => ({
    month: m.month,
    tipo: m.tipo,
    receitasCents: m.receitasCents,
    gastosCents: m.gastosCents,
    sobraCents: m.sobraCents,
    parcelasCents: m.parcelasCents,
    fixasCents: m.fixasCents,
    diaADiaCents: m.diaADiaCents,
    gastoPrevistoCents: m.gastoPrevistoCents,
  }));
  const ultimo = meses.at(-1)!;
  const acumulado = ultimo.acumuladoCents ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-titulo font-semibold tracking-tight text-ink">Mês a mês</h1>
        <p className="text-corpo text-ink-muted">
          O que entra e o que sai em cada mês: os que passaram, com os lançamentos; os que vêm, com as parcelas que vão
          cair, as contas fixas e a média do dia a dia.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Entradas e saídas"
          description={`De ${monthLabel(meses[0]!.month)} a ${monthLabel(ultimo.month)}. Toque num mês para ver os números.`}
        />
        <GraficoDosMeses colunas={colunas} atual={mes} />
        <p className="mt-3 border-t border-line pt-3 text-corpo text-ink-muted">
          Somando as sobras de agora até {monthLabel(ultimo.month).split(" ")[0]}:{" "}
          <span className={cn("tabular font-semibold", acumulado >= 0 ? "text-positive" : "text-danger")}>
            {acumulado < 0 ? "−" : ""}
            {formatCents(Math.abs(acumulado))}
          </span>
        </p>
      </Card>

      <section aria-label="A lista de cada mês" className="space-y-2">
        {meses.map((m) => (
          <ListaDoMes key={m.month} mes={m} />
        ))}
      </section>
    </div>
  );
}
