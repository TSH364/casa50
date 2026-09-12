import { listCalendarEvents, listTransactions } from "@/data/queries";
import { dailySpending, itemsByCategory } from "@/domain/finance";
import { daysInMonth, monthLabel } from "@/domain/month";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { CalendarGrid, type CalendarDay } from "./calendar-grid";
import type { MonthKey } from "@/domain/types";

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
}: {
  houseId: string;
  month: MonthKey;
  memberId: string | null;
  cardId: string | null;
  /** Categorias fora dos totais da casa. Vem de `houseView`. */
  excludeCategoryIds: string[];
}) {
  const ultimo = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

  const [transactions, events] = await Promise.all([
    listTransactions(houseId, { month, excludeCategoryIds }),
    listCalendarEvents(houseId, { from: `${month}-01`, to: ultimo }),
  ]);

  const dias = dailySpending(transactions, month, { memberId, cardId });

  // Os lancamentos de cada dia, sob o mesmo filtro que somou os totais - uma
  // lista que nao fecha com o numero ao lado dela nao serve.
  const porDia = new Map<string, CalendarDay["items"]>();
  for (const lista of itemsByCategory(transactions, month, { memberId, cardId }).values()) {
    for (const item of lista) {
      const atual = porDia.get(item.date) ?? [];
      atual.push({
        id: item.id,
        description: item.description,
        spendCents: item.spendCents,
      });
      porDia.set(item.date, atual);
    }
  }

  const days: CalendarDay[] = dias.map((d) => ({
    ...d,
    events: events
      .filter((e) => d.date >= e.startsOn && d.date <= e.endsOn)
      .map((e) => e.title),
    items: (porDia.get(d.date) ?? []).sort((a, b) => b.spendCents - a.spendCents),
  }));

  const comGasto = days.filter((d) => d.totalCents > 0);
  const total = comGasto.reduce((sum, d) => sum + d.totalCents, 0);
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
            ? `${comGasto.length} de ${days.length} dias com gasto em ${monthLabel(month)}. O maior foi o dia ${maior?.day}, com ${formatCents(maior?.totalCents ?? 0)}.`
            : `Nenhum gasto registrado em ${monthLabel(month)}.`
        }
      />
      <CalendarGrid days={days} month={month} />
    </Card>
  );
}
