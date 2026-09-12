import Link from "next/link";
import { CalendarDays } from "lucide-react";
import {
  listCalendarEvents,
  listCalendarSources,
  listTransactions,
} from "@/data/queries";
import {
  EVENT_KIND_LABEL,
  eventCandidates,
  eventDaysInMonth,
  eventsInMonth,
  isCostly,
  monthPressure,
  spendDuringEvents,
} from "@/domain/calendar";
import { addMonths, currentMonth, daysInMonth, monthLabel } from "@/domain/month";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { EventRows, type EventRow } from "./event-rows";
import type { CalendarEvent, MonthKey } from "@/domain/types";

/**
 * A agenda dentro da Previsão (camadas 1 e 2).
 *
 * Fica aqui, e não numa aba própria, porque a pergunta que ela responde é a
 * mesma da tela: o que vem pela frente e quanto vai custar. Um compromisso
 * marcado é a informação mais barata que existe sobre o mês que vem - ela
 * chega semanas antes da fatura.
 *
 * A ordem do que aparece não é acidental. Primeiro o que a agenda promete
 * (fato: há quatro dias de viagem marcados), depois quanto isso costuma
 * custar (estimativa, com a amostra à vista), e só então o convite para
 * realocar. Inverter isso seria mostrar a conclusão antes da evidência.
 */

/** Quantos meses de histórico alimentam o aprendizado de custo por tipo. */
const HISTORY = 12;

export function AgendaPanelSkeleton() {
  return (
    <Card>
      <CardHeader title="Agenda do mês" />
      <Skeleton className="h-32 w-full" />
    </Card>
  );
}

const DIA_MES = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

function periodo(event: CalendarEvent): string {
  const from = DIA_MES.format(new Date(`${event.startsOn}T00:00:00Z`));
  if (event.startsOn === event.endsOn) return from;
  return `${from} a ${DIA_MES.format(new Date(`${event.endsOn}T00:00:00Z`))}`;
}

export async function AgendaPanel({
  houseId,
  month,
  excludeCategoryIds,
}: {
  houseId: string;
  month: MonthKey;
  /** Categorias fora dos totais da casa. Vem de `houseView`. */
  excludeCategoryIds: string[];
}) {
  const historyFrom = addMonths(month, -HISTORY);
  const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

  const [sources, events, transactions] = await Promise.all([
    listCalendarSources(houseId),
    listCalendarEvents(houseId, { from: `${historyFrom}-01`, to: lastDay }),
    // Um mês a mais na frente: a compra do dia 28 costuma cair na fatura do
    // mês seguinte, e sem ela o gasto dos dias do evento sairia incompleto.
    listTransactions(houseId, {
      fromMonth: historyFrom,
      toMonth: addMonths(month, 1),
      excludeCategoryIds,
      limit: 3000,
    }),
  ]);

  if (sources.length === 0) {
    return (
      <Card>
        <CardHeader
          title="Agenda do mês"
          description="Compromissos marcados são a informação mais antecipada que existe sobre o mês."
        />
        <EmptyState
          title="Nenhuma agenda conectada"
          description="Com o calendário ligado, uma viagem marcada vira aviso antes de virar fatura."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/casa">
                <CalendarDays aria-hidden /> Conectar agenda
              </Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const doMes = eventsInMonth(events, month);
  const pressure = monthPressure(month, events, transactions, {
    today: new Date().toISOString().slice(0, 10),
  });
  const gastoPorEvento = new Map(
    spendDuringEvents(doMes, transactions).map((s) => [s.event.id, s]),
  );

  const linhas: EventRow[] = doMes.map((event) => {
    const gasto = gastoPorEvento.get(event.id);
    return {
      id: event.id,
      title: event.title,
      location: event.location,
      kind: event.kind,
      isCostly: isCostly(event.kind),
      periodo: periodo(event),
      daysInMonth: eventDaysInMonth(event, month),
      totalCents: gasto?.totalCents ?? 0,
      confirmedCount: gasto?.confirmedCount ?? 0,
      candidates: eventCandidates(event, transactions),
    };
  });

  const jaPassou = month < currentMonth();
  const custosos = pressure.events;
  const diasComCusto = custosos.reduce((sum, e) => sum + e.daysInMonth, 0);
  const semBase = custosos.filter((e) => e.extraCents === null);

  return (
    <Card>
      <CardHeader
        title="Agenda do mês"
        description={`${monthLabel(month)} · ${doMes.length} ${doMes.length === 1 ? "compromisso" : "compromissos"}.`}
      />

      {doMes.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-ink-faint">
          Nada marcado neste mês.
        </p>
      ) : (
        <>
          {custosos.length > 0 && !jaPassou ? (
            <div className="mb-4 rounded-[--radius-control] border border-attention/40 bg-attention-soft/30 px-3 py-3">
              <p className="text-[13px] text-ink">
                {diasComCusto === 1
                  ? "Há 1 dia de compromisso que costuma custar neste mês."
                  : `Há ${diasComCusto} dias de compromisso que costumam custar neste mês.`}
              </p>

              {pressure.hasEstimate ? (
                <>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    Pelo que aconteceu nas vezes anteriores, isso aponta{" "}
                    <span className="tabular font-medium text-ink">
                      {formatCents(pressure.extraCents)}
                    </span>{" "}
                    acima de um mês comum.
                  </p>
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                    <div className="flex items-center gap-1.5">
                      <dt className="text-ink-faint">Dia comum da casa:</dt>
                      <dd className="tabular text-ink-muted">
                        {formatCents(pressure.dailyBaselineCents)}
                      </dd>
                    </div>
                    {custosos
                      .filter((e) => e.extraCents !== null)
                      .slice(0, 3)
                      .map((e) => (
                        <div key={e.event.id} className="flex items-center gap-1.5">
                          <dt className="text-ink-faint">
                            {e.event.title} ({e.sampleSize}{" "}
                            {e.sampleSize === 1 ? "vez antes" : "vezes antes"}):
                          </dt>
                          <dd className="tabular text-ink-muted">
                            +{formatCents(e.extraCents!)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  <Button variant="outline" size="sm" className="mt-3" asChild>
                    <Link href={`/orcamentos?mes=${month}`}>Ajustar o mês</Link>
                  </Button>
                </>
              ) : (
                <p className="mt-1 text-[13px] text-ink-muted">
                  Ainda não houve compromisso parecido no histórico para dizer
                  quanto isso costuma custar
                  {semBase.length > 0
                    ? ` — falta um segundo ${EVENT_KIND_LABEL[semBase[0]!.event.kind].toLowerCase()} já realizado para comparar.`
                    : "."}
                </p>
              )}
            </div>
          ) : null}

          <EventRows rows={linhas} />

          <p className="mt-3 text-[12px] text-ink-faint">
            Abra um compromisso para dizer o que é dele e o que não é. Sem essa
            confirmação, o valor ao lado é só o que saiu <em>nos dias</em> — tudo
            que foi lançado naquelas datas, não só o que o compromisso causou.
          </p>
        </>
      )}
    </Card>
  );
}
