import type { Cents } from "@/lib/money";
import { toCents } from "@/lib/money";
import type {
  CalendarEvent,
  EventKind,
  IsoDate,
  MonthKey,
  Transaction,
} from "./types";
import { daysInMonth } from "./month";
import { spendingCents } from "./finance";
import {
  fixedChargeMerchants,
  notEventSpend,
  type NotEventReason,
} from "./recurring";

/**
 * Agenda: do compromisso marcado ao gasto previsto.
 *
 * Tres camadas, nesta ordem de confianca:
 *
 * 1. **Fato** - que dias do mes tem compromisso, e quanto saiu nesses dias.
 *    Isso e leitura, nao interpretacao: os lancamentos existem e as datas
 *    tambem.
 * 2. **Estimativa** - quanto um compromisso do mesmo tipo custou das outras
 *    vezes. So existe quando ha "outras vezes"; com uma viagem no historico
 *    nao da para dizer o que uma viagem custa, e a funcao devolve `null` em
 *    vez de inventar.
 * 3. **Proposta** - fica em `rebalance.ts`, e so roda em cima de (2).
 *
 * A regra que atravessa o arquivo e a mesma da secao 20 e do `insights.ts`:
 * nenhuma conclusao sem a evidencia junto. "Voce vai gastar R$ 1.200 nessa
 * viagem" e chute; "as duas viagens anteriores custaram R$ 380 por dia acima
 * do dia normal, e esta tem 4 dias" e informacao.
 */

// Os tipos vivem em `types.ts`, junto com o resto do espelho do schema; aqui
// ficam so as regras que operam sobre eles.
export type { CalendarEvent, EventKind };

// --------------------------------------------------------------------------
// Classificacao
// --------------------------------------------------------------------------

/**
 * Regras de titulo, na ordem em que sao testadas.
 *
 * Mesma forma da tabela de estabelecimentos do importador: ordenada, porque a
 * primeira que casa vence, e "jantar de aniversario" tem que virar
 * comemoracao antes de qualquer regra generica de jantar.
 *
 * O que NAO esta aqui e tao deliberado quanto o que esta. Nomes de companhia
 * aerea ficaram de fora ("azul", "gol") porque sao palavras comuns em
 * portugues, e classificar "camisa azul" como viagem seria pior do que nao
 * classificar nada.
 */
const EVENT_RULES: { pattern: RegExp; kind: EventKind }[] = [
  // Deslocamento: a palavra sozinha ja diz que a casa saiu de casa.
  {
    kind: "trip",
    pattern:
      /\b(viagem|viajar|viajando|voo|embarque|desembarque|aeroporto|f[eé]rias|feria[dõo]|passagem a[eé]rea|cruzeiro|trip|flight)\b/i,
  },
  {
    kind: "celebration",
    pattern:
      /\b(anivers[aá]rio|niver|casamento|bodas|formatura|batizado|ch[aá] de (beb[eê]|panela|casa nova)|festa|confraterniza[cç][aã]o|r[eé]veillon|natal|p[aá]scoa|noivado)\b/i,
  },
  {
    kind: "health",
    // "dr." e "dra." ficaram DE FORA, e o motivo esta numa agenda real: o
    // endereco entra na busca junto com o titulo, e meia cidade brasileira
    // mora em "Rua Dr. Fulano". Com esses dois tokens, "Retirar diploma" na
    // Rua Dr. Alvaro Alvim virava consulta medica, e um almoco na Av. Dr.
    // Arnaldo tambem. Duas letras casam por acaso; os nomes abaixo, nao.
    pattern:
      /\b(consulta|dentista|m[eé]dic[oa]|exame|laborat[oó]rio|psiquiatra|terapia|fisioterapia|vacina|cirurgia|hospital|pronto[ -]?socorro|check[ -]?up|vet|odonto\w*|psic[oó]log\w*|nutricion\w*|oftalmo\w*|dermato\w*|cardiolog\w*|ortoped\w*|pediatr\w*|ginecolog\w*|endocrino\w*|urolog\w*|veterin\w*)\b/i,
  },
  {
    kind: "education",
    pattern:
      /\b(curso|aula|prova|workshop|palestra|matr[ií]cula|semestre|faculdade|vestibular|congresso|treinamento|mentoria)\b/i,
  },
  {
    kind: "home",
    pattern:
      /\b(obra|reforma|mudan[cç]a|pintor|marceneir[oa]|encanador|eletricista|manuten[cç][aã]o|entrega|instala[cç][aã]o|vistoria|condom[ií]nio)\b/i,
  },
  {
    kind: "work",
    pattern:
      /\b(reuni[aã]o|meeting|call|daily|sprint|1:1|one[ -]?on[ -]?one|entrevista|apresenta[cç][aã]o|deadline|entrega do projeto)\b/i,
  },
  // Hospedagem entra DEPOIS de comemoracao, e essa ordem e o ponto: "jantar de
  // aniversario no hotel" e um aniversario que por acaso acontece num hotel,
  // enquanto "viagem de aniversario" ja foi capturado la em cima como viagem.
  // Local nao decide o tipo do compromisso; o motivo decide.
  {
    kind: "trip",
    pattern: /\b(hotel|pousada|airbnb|hospedagem|resort|retiro|check[ -]?in|holiday)\b/i,
  },
];

/**
 * Que tipo de compromisso e este.
 *
 * O local entra na busca junto com o titulo: "Fim de semana" nao diz nada,
 * "Fim de semana / Pousada do Sol" diz tudo.
 */
export function classifyEvent(title: string, location?: string | null): EventKind {
  const haystack = `${title} ${location ?? ""}`;
  for (const rule of EVENT_RULES) {
    if (rule.pattern.test(haystack)) return rule.kind;
  }
  return "other";
}

/**
 * Tipos que costumam trazer gasto junto.
 *
 * Reuniao e aula nao entram: repetem toda semana e nao movem a fatura, e
 * alertar sobre elas encheria a tela de aviso sem consequencia.
 */
const COSTLY: ReadonlySet<EventKind> = new Set<EventKind>([
  "trip",
  "celebration",
  "health",
  "home",
]);

export function isCostly(kind: EventKind): boolean {
  return COSTLY.has(kind);
}

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  trip: "Viagem",
  health: "Saúde",
  celebration: "Comemoração",
  education: "Estudo",
  home: "Casa",
  work: "Trabalho",
  other: "Outro",
};

// --------------------------------------------------------------------------
// Dias
// --------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

function dayNumber(iso: IsoDate): number {
  return Math.round(
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10)),
    ) / MS_PER_DAY,
  );
}

function isoOfDay(day: number): IsoDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Teto de dias percorridos por evento.
 *
 * Uma agenda com um evento de dez anos ("mudanca para a casa nova") existe, e
 * sem o teto a varredura dia a dia dela sozinha travaria a pagina.
 */
const MAX_EVENT_DAYS = 400;

/** Todos os dias cobertos por algum evento, para consulta em tempo constante. */
function coveredDates(events: readonly Pick<CalendarEvent, "startsOn" | "endsOn">[]): Set<IsoDate> {
  const out = new Set<IsoDate>();
  for (const event of events) {
    const from = dayNumber(event.startsOn);
    const to = Math.min(dayNumber(event.endsOn), from + MAX_EVENT_DAYS);
    for (let day = from; day <= to; day += 1) out.add(isoOfDay(day));
  }
  return out;
}

/** Quantos dias o evento ocupa, contando o primeiro e o ultimo. */
export function eventDays(event: Pick<CalendarEvent, "startsOn" | "endsOn">): number {
  return Math.max(1, dayNumber(event.endsOn) - dayNumber(event.startsOn) + 1);
}

/**
 * Quantos dias do evento caem dentro do mes.
 *
 * Uma viagem de 28/12 a 04/01 pesa quatro dias em janeiro, nao oito - e a
 * fatura de janeiro so ve esses quatro.
 */
export function eventDaysInMonth(
  event: Pick<CalendarEvent, "startsOn" | "endsOn">,
  month: MonthKey,
): number {
  const from = Math.max(dayNumber(event.startsOn), dayNumber(`${month}-01`));
  const to = Math.min(
    dayNumber(event.endsOn),
    dayNumber(`${month}-${String(daysInMonth(month)).padStart(2, "0")}`),
  );
  return Math.max(0, to - from + 1);
}

export function eventsInMonth<T extends Pick<CalendarEvent, "startsOn" | "endsOn">>(
  events: readonly T[],
  month: MonthKey,
): T[] {
  return events
    .filter((e) => eventDaysInMonth(e, month) > 0)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

// --------------------------------------------------------------------------
// Camada 1: o que saiu nos dias do compromisso
// --------------------------------------------------------------------------

export interface EventSpend {
  event: CalendarEvent;
  /** Lancamentos com data dentro do evento. */
  transactions: Transaction[];
  /**
   * Soma desses lancamentos.
   *
   * Repare no nome: e o gasto NOS DIAS do evento, nao "o gasto do evento". A
   * assinatura que cobra dia 12 nao virou despesa de viagem por a viagem ter
   * comecado dia 11, e a tela precisa dizer isso com essas palavras.
   */
  totalCents: Cents;
  days: number;
  /** Quantos dos lancamentos acima foram confirmados por uma pessoa. */
  confirmedCount: number;
}

function countable(t: Transaction): boolean {
  return !t.isHidden && t.status !== "cancelled" && t.status !== "forecast";
}

/**
 * Liga lancamentos a compromissos pela data.
 *
 * Cada lancamento serve a um evento so. Quando ha mais de um candidato no
 * mesmo dia, vence o mais especifico: primeiro o que costuma custar, depois o
 * mais curto - um almoco de aniversario dentro de uma viagem de sete dias
 * pertence ao aniversario, que e o evento daquele dia.
 */
export function spendDuringEvents(
  events: readonly CalendarEvent[],
  transactions: readonly Transaction[],
): EventSpend[] {
  const ranked = [...events].sort((a, b) => {
    const costly = Number(isCostly(b.kind)) - Number(isCostly(a.kind));
    if (costly !== 0) return costly;
    return eventDays(a) - eventDays(b);
  });

  const byEvent = new Map<string, Transaction[]>(ranked.map((e) => [e.id, []]));
  const taken = new Set<string>();

  // Primeiro o que uma PESSOA decidiu. A decisao vale contra a data: uma
  // lembranca comprada uma semana antes da festa pertence a festa, e a
  // assinatura que caiu no meio da viagem nao pertence a viagem. Nada disso a
  // coincidencia de datas consegue saber.
  for (const t of transactions) {
    if (!t.eventLinkDecided || !countable(t) || spendingCents(t) <= 0) continue;
    taken.add(t.id);
    // Decidido sem evento e "nao e de compromisso nenhum": sai da conta, e
    // nao volta pela porta do palpite.
    if (t.calendarEventId === null) continue;
    byEvent.get(t.calendarEventId)?.push(t);
  }

  // Indice por data para o resto: sem ele a varredura seria eventos x
  // lancamentos, o que numa agenda de um ano com tres mil linhas de fatura
  // passa de seis milhoes de comparacoes a cada render da pagina.
  //
  // O que o app SABE que nao e do compromisso fica fora do indice, e portanto
  // fora do palpite por data. Sem isso, a parcela - que guarda a data da
  // compra original e reaparece todo mes com ela - somava a mesma compra
  // varias vezes num unico dia: MEDIDO na base real, um compromisso em
  // 10/11/2025 somaria R$ 4.884 onde existe uma cobranca de R$ 2.442.
  const fixed = fixedChargeMerchants(transactions);
  const byDate = new Map<IsoDate, Transaction[]>();
  for (const t of transactions) {
    if (taken.has(t.id)) continue;
    if (!countable(t) || spendingCents(t) <= 0) continue;
    if (notEventSpend(t, fixed) !== null) continue;
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }

  for (const event of ranked) {
    const from = dayNumber(event.startsOn);
    const to = Math.min(dayNumber(event.endsOn), from + MAX_EVENT_DAYS);
    for (let day = from; day <= to; day += 1) {
      for (const t of byDate.get(isoOfDay(day)) ?? []) {
        if (taken.has(t.id)) continue;
        taken.add(t.id);
        byEvent.get(event.id)!.push(t);
      }
    }
  }

  return events
    .map((event) => {
      const list = byEvent.get(event.id) ?? [];
      return {
        event,
        transactions: list.sort((a, b) => a.date.localeCompare(b.date)),
        totalCents: list.reduce((sum, t) => sum + spendingCents(t), 0),
        days: eventDays(event),
        confirmedCount: list.filter((t) => t.eventLinkDecided).length,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
}

// --------------------------------------------------------------------------
// Camada 2: quanto um compromisso desses costuma custar a mais
// --------------------------------------------------------------------------

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? 0);
}

/**
 * Quanto a casa gasta num dia comum, sem compromisso na agenda.
 *
 * A mediana, e nao a media: um dia com a anuidade do cartao levantaria a media
 * do mes inteiro e faria toda viagem parecer barata por comparacao.
 *
 * Dias sem lancamento nenhum contam como zero - sao dias comuns tambem, e
 * ignora-los inflaria a linha de base ate o ponto de nenhuma viagem parecer
 * cara.
 */
export function dailyBaselineCents(
  transactions: readonly Transaction[],
  events: readonly CalendarEvent[],
): Cents {
  const withData = [...new Set(transactions.filter(countable).map((t) => t.date.slice(0, 7)))];
  if (withData.length === 0) return 0;

  const spentByDay = new Map<IsoDate, Cents>();
  for (const t of transactions) {
    if (!countable(t)) continue;
    const spend = spendingCents(t);
    if (spend <= 0) continue;
    spentByDay.set(t.date, (spentByDay.get(t.date) ?? 0) + spend);
  }

  const comCompromisso = coveredDates(events);
  const values: Cents[] = [];
  for (const month of withData) {
    for (let day = 1; day <= daysInMonth(month); day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      if (comCompromisso.has(date)) continue;
      values.push(spentByDay.get(date) ?? 0);
    }
  }

  return values.length === 0 ? 0 : median(values);
}

export interface KindCost {
  kind: EventKind;
  /** Quantos eventos passados desse tipo entraram na conta. */
  sampleSize: number;
  /** Mediana do gasto por dia ACIMA do dia comum. Nunca negativo. */
  extraPerDayCents: Cents;
}

/**
 * Quanto custa, por dia, um compromisso de cada tipo — aprendido do passado.
 *
 * Exige `minSample` eventos ja acontecidos do mesmo tipo. Com um so, "viagem
 * custa X" seria a descricao daquela viagem, nao uma previsao.
 */
export function costByKind(
  events: readonly CalendarEvent[],
  transactions: readonly Transaction[],
  options: { today?: IsoDate; minSample?: number; baselineCents?: Cents } = {},
): Map<EventKind, KindCost> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const minSample = options.minSample ?? 2;

  const past = events.filter((e) => e.endsOn < today && isCostly(e.kind));
  // Recebe a linha de base pronta quando quem chama ja a calculou: refaze-la
  // significaria varrer o ano inteiro de dias uma segunda vez.
  const baseline = options.baselineCents ?? dailyBaselineCents(transactions, events);
  const spend = new Map(
    spendDuringEvents(past, transactions).map((s) => [s.event.id, s]),
  );

  const perKind = new Map<EventKind, number[]>();
  for (const event of past) {
    const found = spend.get(event.id);
    if (!found) continue;
    const days = found.days;
    // Acima do dia comum: o que a casa gastaria de qualquer jeito nao e custo
    // da viagem. Sem isso, uma viagem de dez dias "custaria" dez dias de vida
    // normal, e a previsao dobraria o gasto do mes.
    const extra = Math.max(0, found.totalCents - baseline * days);
    const list = perKind.get(event.kind);
    if (list) list.push(Math.round(extra / days));
    else perKind.set(event.kind, [Math.round(extra / days)]);
  }

  const out = new Map<EventKind, KindCost>();
  for (const [kind, values] of perKind) {
    if (values.length < minSample) continue;
    out.set(kind, {
      kind,
      sampleSize: values.length,
      extraPerDayCents: Math.max(0, median(values)),
    });
  }
  return out;
}

export interface PressureEvent {
  event: CalendarEvent;
  /** Dias do evento que caem no mes analisado. */
  daysInMonth: number;
  /** Estimativa de gasto extra. `null` quando nao ha base para estimar. */
  extraCents: Cents | null;
  /** Quantos eventos do mesmo tipo sustentam a estimativa. */
  sampleSize: number;
}

export interface MonthPressure {
  month: MonthKey;
  /** Compromissos do mes que costumam custar. Vazio nao gera alerta. */
  events: PressureEvent[];
  /** Soma das estimativas. Zero quando nenhuma tem base. */
  extraCents: Cents;
  /** Verdadeiro quando pelo menos um evento tem estimativa com historico. */
  hasEstimate: boolean;
  dailyBaselineCents: Cents;
}

/**
 * O que a agenda promete para o mes (camada 2).
 *
 * Devolve os eventos mesmo sem conseguir estimar: saber que ha quatro dias de
 * viagem marcados ja e informacao util, e a tela diz com todas as letras que
 * ainda nao da para dizer quanto custa.
 */
export function monthPressure(
  month: MonthKey,
  events: readonly CalendarEvent[],
  transactions: readonly Transaction[],
  options: { today?: IsoDate; minSample?: number } = {},
): MonthPressure {
  const baseline = dailyBaselineCents(transactions, events);
  const costs = costByKind(events, transactions, { ...options, baselineCents: baseline });

  const list: PressureEvent[] = eventsInMonth(events, month)
    .filter((e) => isCostly(e.kind))
    .map((event) => {
      const days = eventDaysInMonth(event, month);
      const cost = costs.get(event.kind);
      return {
        event,
        daysInMonth: days,
        extraCents: cost ? cost.extraPerDayCents * days : null,
        sampleSize: cost?.sampleSize ?? 0,
      };
    });

  return {
    month,
    events: list,
    extraCents: list.reduce((sum, e) => sum + (e.extraCents ?? 0), 0),
    hasEstimate: list.some((e) => e.extraCents !== null && e.extraCents > 0),
    dailyBaselineCents: baseline,
  };
}

/** Soma dos limites de orcamento do mes, para a tela comparar com a pressao. */
export function budgetTotalCents(
  budgets: readonly { month: MonthKey; limitAmount: number }[],
  month: MonthKey,
): Cents {
  return budgets
    .filter((b) => b.month === month)
    .reduce((sum, b) => sum + toCents(b.limitAmount), 0);
}

export interface EventCandidate {
  id: string;
  description: string;
  date: IsoDate;
  spendCents: Cents;
  /**
   * `linked` - alguem confirmou que e deste compromisso.
   * `excluded` - alguem disse que nao e (deste, ou de nenhum).
   * `guess` - ninguem opinou; entra na conta so pela data.
   */
  state: "linked" | "excluded" | "guess";
  /**
   * Motivo pelo qual o app ja deixou de fora, sem ninguem mandar.
   *
   * `null` quando entra normalmente. Preenchido, a linha aparece apagada e com
   * o motivo escrito - continua clicavel, porque uma passagem parcelada PODE
   * ser da viagem e so a pessoa sabe.
   */
  autoExcluded: NotEventReason | null;
}

/**
 * O que a casa precisa ver para decidir o vinculo de um compromisso.
 *
 * Traz os lancamentos dos dias do evento em QUALQUER estado - inclusive os ja
 * recusados - mais os que foram vinculados a ele de fora dos dias. Mostrar so
 * o que esta contando agora impediria justamente o gesto de corrigir: quem
 * marcou errado precisa reencontrar a linha para desmarcar.
 */
export function eventCandidates(
  event: CalendarEvent,
  transactions: readonly Transaction[],
): EventCandidate[] {
  const from = dayNumber(event.startsOn);
  const to = Math.min(dayNumber(event.endsOn), from + MAX_EVENT_DAYS);
  const fixed = fixedChargeMerchants(transactions);

  const out: EventCandidate[] = [];
  for (const t of transactions) {
    if (!countable(t)) continue;
    const spend = spendingCents(t);
    if (spend <= 0) continue;

    const day = dayNumber(t.date);
    const nosDias = day >= from && day <= to;
    const vinculado = t.eventLinkDecided && t.calendarEventId === event.id;
    if (!nosDias && !vinculado) continue;

    // Decisao humana apaga o motivo automatico: quem vinculou a mao ja
    // respondeu a pergunta, e o app nao volta a discuti-la.
    const motivo = t.eventLinkDecided ? null : notEventSpend(t, fixed);

    out.push({
      id: t.id,
      description: t.merchantAlias ?? t.description,
      date: t.date,
      spendCents: spend,
      state: vinculado ? "linked" : t.eventLinkDecided ? "excluded" : "guess",
      autoExcluded: motivo,
    });
  }

  // Os deixados de fora descem para o fim: a lista existe para decidir o que
  // E do compromisso, e o que o app ja resolveu nao deve disputar o topo.
  return out.sort((a, b) => {
    const fora = Number(a.autoExcluded !== null) - Number(b.autoExcluded !== null);
    if (fora !== 0) return fora;
    return b.spendCents - a.spendCents;
  });
}
