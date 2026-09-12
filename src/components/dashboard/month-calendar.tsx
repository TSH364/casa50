import { listCalendarEvents, listTransactions } from "@/data/queries";
import { dailySpending, itemsByCategory } from "@/domain/finance";
import { addMonths, daysInMonth, monthLabel } from "@/domain/month";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { CalendarGrid, type CalendarDay } from "./calendar-grid";
import type { Category, MonthKey } from "@/domain/types";

export function MonthCalendarSkeleton() {
  return (
    <Card>
      <CardHeader title="Dia a dia" />
      <Skeleton className="h-56 w-full" />
    </Card>
  );
}

/**
 * O mes visto dia a dia (secao 7).
 *
 * O mapa de fluxo compara meses; este mostra o DESENHO de um mes por dentro.
 * Sao perguntas diferentes: "gastamos mais que em julho?" e "o que aconteceu
 * na terceira semana?" - e a segunda nenhuma barra mensal responde.
 */
export async function MonthCalendar({
  houseId,
  month,
  memberId,
  cardId,
  excludeCategoryIds,
  categories,
}: {
  houseId: string;
  month: MonthKey;
  memberId: string | null;
  cardId: string | null;
  /** Categorias fora dos totais da casa. Vem de `houseView`. */
  excludeCategoryIds: string[];
  /** Todas as categorias da casa, para colorir os lançamentos do dia. */
  categories: Category[];
}) {
  const ultimo = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

  const [transactions, events] = await Promise.all([
    listTransactions(houseId, { month, excludeCategoryIds }),
    listCalendarEvents(houseId, { from: `${month}-01`, to: ultimo }),
  ]);

  const diario = dailySpending(transactions, month, { memberId, cardId });
  // O mes DESENHADO e o das compras, que na fatura de cartao e anterior ao mes
  // dela. Tudo daqui para baixo usa este, e nao `month`.
  const gridMonth = diario.month;

  // Os lancamentos de cada dia, sob o mesmo filtro que somou os totais - uma
  // lista que nao fecha com o numero ao lado dela nao serve.
  // A chave do mapa JA e a categoria - a cor sai daí sem consulta extra.
  // Subcategoria herda a cor da mãe, então o ponto continua dizendo "isto é
  // Alimentação" mesmo quando o lançamento está numa subcategoria dela.
  const porCategoria = new Map(categories.map((c) => [c.id, c]));
  const porDia = new Map<string, CalendarDay["items"]>();
  for (const [categoryId, lista] of itemsByCategory(transactions, month, {
    memberId,
    cardId,
  })) {
    const categoria = categoryId ? porCategoria.get(categoryId) : undefined;
    for (const item of lista) {
      const atual = porDia.get(item.date) ?? [];
      atual.push({
        id: item.id,
        description: item.description,
        spendCents: item.spendCents,
        categoryColor: categoria?.color ?? null,
        categoryName: categoria?.name ?? null,
      });
      porDia.set(item.date, atual);
    }
  }

  const days: CalendarDay[] = diario.days.map((d) => ({
    ...d,
    events: events
      .filter((e) => d.date >= e.startsOn && d.date <= e.endsOn)
      .map((e) => e.title),
    items: (porDia.get(d.date) ?? []).sort((a, b) => b.spendCents - a.spendCents),
  }));

  const comGasto = days.filter((d) => d.totalCents > 0);
  const maior = comGasto.reduce(
    (a, d) => (d.totalCents > (a?.totalCents ?? 0) ? d : a),
    comGasto[0],
  );

  return (
    <Card>
      <CardHeader
        title="Dia a dia"
        description={
          comGasto.length > 0
            ? `${comGasto.length} de ${days.length} dias com gasto. O maior foi o dia ${maior?.day}, com ${formatCents(maior?.totalCents ?? 0)}.`
            : `Nenhum gasto registrado em ${monthLabel(gridMonth)}.`
        }
      />

      {/* Qual mes esta na tela, dito sempre - nao so quando difere.
          A fatura de um mes cobra compras do mes anterior, e um calendario que
          nao diz de quando sao os dias faz o casal procurar no dia errado. */}
      <p className="mb-2.5 text-[12px] text-ink-faint">
        Compras de <span className="text-ink-muted">{monthLabel(gridMonth)}</span>
        {gridMonth === month ? null : (
          <> — é o que a fatura de {monthLabel(month)} cobra.</>
        )}
      </p>

      <CalendarGrid days={days} month={gridMonth} />

      {/* O que ficou fora da grade, discriminado.
          Sao duas coisas diferentes e o texto nao pode juntar: a compra do mes
          anterior entrou na MESMA fatura porque o cartao fecha no meio do mes;
          a de um ano atras e parcela, que guarda a data da compra original. */}
      {diario.outsideCount > 0 ? (
        <ul className="mt-2.5 space-y-1 border-t border-line pt-2.5 text-[12px] text-ink-faint">
          {diario.outsideByMonth.map((fora) => (
            <li key={fora.month}>
              Mais {formatCents(fora.totalCents)} em {fora.count} compra(s) de{" "}
              {monthLabel(fora.month)}
              {fora.month === addMonths(gridMonth, -1)
                ? " — o cartão fecha no meio do mês, e elas caem nesta mesma fatura."
                : " — parcela guarda a data da compra original."}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
