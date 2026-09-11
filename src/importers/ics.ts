import type { IsoDate } from "@/domain/types";

/**
 * Leitor de agenda no formato iCalendar (RFC 5545).
 *
 * Por que iCalendar e nao a API do Google: o Google Agenda publica, em
 * Configuracoes > Integrar agenda, um "endereco secreto no formato iCal". E
 * uma URL que o servidor le direto, sem OAuth, sem projeto no Google Cloud,
 * sem tela de consentimento e sem token para renovar. E somente-leitura por
 * construcao - a URL nao da acesso a escrever nada, nem a qualquer outro
 * servico da conta. Para uma casa de duas pessoas isso entrega o mesmo dado
 * com uma fracao da cerimonia. O campo `kind` da tabela existe para o dia em
 * que OAuth for necessario; o resto do sistema nao precisa saber a diferenca.
 *
 * O que este arquivo devolve sao OCORRENCIAS, nao eventos: uma reuniao
 * semanal e um `VEVENT` com `RRULE` no arquivo, e aqui vira uma linha por
 * semana dentro da janela pedida. Quem consome quer saber "que dias do mes
 * tem viagem", e essa pergunta se responde sobre ocorrencias.
 *
 * Deliberadamente ignorado: hora do dia. O Fluxo associa gasto a evento por
 * DIA - um lancamento nao tem hora, entao guardar o horario do evento daria
 * uma precisao que a outra ponta nao tem.
 */

export interface IcsOccurrence {
  /** `UID` do evento. Repete entre as ocorrencias de uma mesma serie. */
  uid: string;
  title: string;
  location: string | null;
  /** Primeiro dia, inclusivo. */
  startsOn: IsoDate;
  /** Ultimo dia, inclusivo. Igual a `startsOn` num evento de um dia so. */
  endsOn: IsoDate;
  allDay: boolean;
}

export interface IcsWindow {
  from: IsoDate;
  to: IsoDate;
}

export interface IcsResult {
  occurrences: IcsOccurrence[];
  /** Quantos `VEVENT` o arquivo tinha, antes de expandir repeticoes. */
  eventCount: number;
  /** Verdadeiro quando o corte de seguranca interrompeu a expansao. */
  truncated: boolean;
}

/**
 * Teto de ocorrencias devolvidas.
 *
 * Uma agenda com "todo dia util, para sempre" gera dezenas de milhares de
 * linhas numa janela de anos. O corte protege o banco e a tela; a janela
 * pedida pelo chamador ja e o filtro principal.
 */
const MAX_OCCURRENCES = 4000;

/** Teto de iteracoes por serie, para uma RRULE malformada nao travar o loop. */
const MAX_STEPS = 2000;

// --------------------------------------------------------------------------
// Datas: aritmetica em numero de dias, nunca em `Date` local
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

function addDays(iso: IsoDate, delta: number): IsoDate {
  return isoOfDay(dayNumber(iso) + delta);
}

/** 0 = domingo, como `Date.getUTCDay`. */
function weekday(iso: IsoDate): number {
  return ((dayNumber(iso) + 4) % 7 + 7) % 7;
}

/** Ultimo dia do mes de `iso`. */
function daysInMonthOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Soma meses preservando o dia quando ele existe.
 *
 * Devolve `null` quando o dia nao cabe no mes de destino (31 de marco + 1
 * mes). A RFC 5545 manda PULAR esse mes, nao empurrar para o dia 28 - e
 * empurrar criaria uma cobranca em fevereiro que a agenda nao tem.
 */
function addMonthsStrict(iso: IsoDate, delta: number): IsoDate | null {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const index = month - 1 + delta;
  const nextYear = year + Math.floor(index / 12);
  const nextMonth = ((index % 12) + 12) % 12 + 1;
  if (day > daysInMonthOf(nextYear, nextMonth)) return null;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * Em que DIA, no fuso da casa, cai um instante UTC.
 *
 * Um evento marcado para 22h de Brasilia chega no arquivo como `T010000Z` do
 * dia seguinte. Fatiar a string daria o dia errado, e a diferenca aparece
 * justamente na virada - onde a associacao com o gasto importa.
 */
function zonedDate(instant: Date, timeZone: string): IsoDate {
  let formatter = ZONE_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    ZONE_FORMATTERS.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// --------------------------------------------------------------------------
// Leitura bruta do arquivo
// --------------------------------------------------------------------------

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * Desdobra as linhas do arquivo.
 *
 * O iCalendar quebra linhas longas em 75 octetos e marca a continuacao com um
 * espaco ou tab no inicio. Sem desdobrar, um titulo longo chega partido ao
 * meio - e e justamente o titulo que classifica o evento.
 */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** `\n`, `\,`, `\;` e `\\` conforme a RFC. */
function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, ch: string) =>
    ch === "n" || ch === "N" ? "\n" : ch,
  );
}

function parseProperty(line: string): IcsProperty | null {
  // O primeiro `:` fora de aspas separa nome+parametros do valor.
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const segments: string[] = [];
  let current = "";
  quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ";" && !quoted) {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);

  const name = (segments.shift() ?? "").toUpperCase();
  if (name === "") return null;

  const params: Record<string, string> = {};
  for (const segment of segments) {
    const equals = segment.indexOf("=");
    if (equals < 0) continue;
    params[segment.slice(0, equals).toUpperCase()] = segment.slice(equals + 1);
  }

  return { name, params, value };
}

// --------------------------------------------------------------------------
// Datas de uma propriedade
// --------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

interface PropertyDate {
  date: IsoDate;
  allDay: boolean;
}

/**
 * Converte o valor de DTSTART/DTEND/EXDATE no dia local correspondente.
 *
 * Sem `Z` no fim, o horario e local (com ou sem TZID) e o dia escrito ja e o
 * dia que a pessoa ve na agenda - fatiar a string e o certo. Com `Z`, e um
 * instante UTC e precisa ser trazido para o fuso da casa.
 */
function propertyDate(
  property: IcsProperty,
  timeZone: string,
): PropertyDate | null {
  const value = property.value.trim();

  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, allDay: true };
  }

  const dateTime = DATE_TIME.exec(value);
  if (!dateTime) return null;

  const [, y, m, d, hh, mm, ss, utc] = dateTime;
  if (utc === "Z") {
    const instant = new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
    );
    return { date: zonedDate(instant, timeZone), allDay: false };
  }
  return { date: `${y}-${m}-${d}`, allDay: false };
}

/** `P3D`, `PT2H30M`, `P1W` -> duracao em dias inteiros, arredondando para cima. */
function durationInDays(value: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim().toUpperCase(),
  );
  if (!match) return null;
  const [, weeks, days, hours, minutes, seconds] = match;
  const total =
    Number(weeks ?? 0) * 7 +
    Number(days ?? 0) +
    (Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) /
      86_400;
  return total;
}

// --------------------------------------------------------------------------
// RRULE
// --------------------------------------------------------------------------

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

interface Rrule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: IsoDate | null;
  /** Para WEEKLY: dias da semana (0-6). Para MONTHLY: `{ordinal, weekday}`. */
  byDay: { ordinal: number | null; weekday: number }[];
  byMonthDay: number[];
}

function parseRrule(value: string, timeZone: string): Rrule | null {
  const parts: Record<string, string> = {};
  for (const chunk of value.split(";")) {
    const equals = chunk.indexOf("=");
    if (equals > 0) {
      parts[chunk.slice(0, equals).toUpperCase()] = chunk.slice(equals + 1);
    }
  }

  const freq = (parts.FREQ ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    // FREQ=HOURLY e companhia nao descrevem compromisso de agenda pessoal.
    // Devolver `null` faz o evento valer so pela data inicial, que e honesto.
    return null;
  }

  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1);
  const count = parts.COUNT ? Math.max(0, Number(parts.COUNT) || 0) : null;

  // UNTIL e uma FRONTEIRA, e quase sempre chega como meia-noite UTC
  // (`20260120T000000Z`). Traduzir esse instante para o fuso de Brasilia o
  // jogaria para as 21h do dia 19 e derrubaria a ultima ocorrencia da serie.
  // Numa leitura por dia, o certo e ficar com a data escrita: incluir um dia
  // a mais e menos errado do que perder o ultimo compromisso.
  const until: IsoDate | null = /^\d{8}/.test(parts.UNTIL ?? "")
    ? `${parts.UNTIL!.slice(0, 4)}-${parts.UNTIL!.slice(4, 6)}-${parts.UNTIL!.slice(6, 8)}`
    : null;

  const byDay: Rrule["byDay"] = [];
  for (const token of (parts.BYDAY ?? "").split(",")) {
    const match = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token.trim().toUpperCase());
    if (!match) continue;
    byDay.push({
      ordinal: match[1] ? Number(match[1]) : null,
      weekday: WEEKDAYS.indexOf(match[2] as (typeof WEEKDAYS)[number]),
    });
  }

  const byMonthDay = (parts.BYMONTHDAY ?? "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v >= 1 && v <= 31);

  return { freq, interval, count, until, byDay, byMonthDay };
}

/** Primeiro dia da semana (segunda) que contem `iso`. */
function weekStart(iso: IsoDate): IsoDate {
  const shift = (weekday(iso) + 6) % 7;
  return addDays(iso, -shift);
}

/**
 * Datas de inicio geradas por uma RRULE, em ordem.
 *
 * COUNT e contado desde a primeira ocorrencia, mesmo as anteriores a janela -
 * senao uma serie "10 vezes" que comecou ano passado devolveria 10 novas.
 */
function expandRrule(
  dtstart: IsoDate,
  rule: Rrule,
  windowEnd: IsoDate,
): IsoDate[] {
  const out: IsoDate[] = [];
  let produced = 0;
  const hardStop = rule.until && rule.until < windowEnd ? rule.until : windowEnd;

  const push = (date: IsoDate): boolean => {
    if (date < dtstart) return true;
    if (rule.until && date > rule.until) return false;
    produced += 1;
    if (rule.count !== null && produced > rule.count) return false;
    out.push(date);
    return true;
  };

  if (rule.freq === "DAILY") {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const date = addDays(dtstart, step * rule.interval);
      if (date > hardStop) break;
      if (!push(date)) break;
    }
    return out;
  }

  if (rule.freq === "WEEKLY") {
    const days =
      rule.byDay.length > 0
        ? [...new Set(rule.byDay.map((d) => d.weekday))].sort((a, b) => a - b)
        : [weekday(dtstart)];
    const firstWeek = weekStart(dtstart);
    outer: for (let step = 0; step < MAX_STEPS; step += 1) {
      const base = addDays(firstWeek, step * rule.interval * 7);
      if (base > hardStop) break;
      for (const day of days) {
        // Semana comeca na segunda; domingo e o ultimo dia dela.
        const date = addDays(base, (day + 6) % 7);
        if (date > hardStop) continue;
        if (!push(date)) break outer;
      }
    }
    return out;
  }

  if (rule.freq === "MONTHLY") {
    const ordinals = rule.byDay.filter((d) => d.ordinal !== null);
    outer: for (let step = 0; step < MAX_STEPS; step += 1) {
      const anchor = addMonthsStrict(`${dtstart.slice(0, 8)}01`, step * rule.interval);
      if (!anchor) break;
      if (anchor > hardStop) break;

      const candidates: IsoDate[] = [];
      if (ordinals.length > 0) {
        const year = Number(anchor.slice(0, 4));
        const month = Number(anchor.slice(5, 7));
        const total = daysInMonthOf(year, month);
        for (const { ordinal, weekday: target } of ordinals) {
          const matching: IsoDate[] = [];
          for (let day = 1; day <= total; day += 1) {
            const date = `${anchor.slice(0, 8)}${String(day).padStart(2, "0")}`;
            if (weekday(date) === target) matching.push(date);
          }
          const picked =
            ordinal! > 0 ? matching[ordinal! - 1] : matching[matching.length + ordinal!];
          if (picked) candidates.push(picked);
        }
      } else {
        const days = rule.byMonthDay.length > 0 ? rule.byMonthDay : [Number(dtstart.slice(8, 10))];
        for (const day of days) {
          const date = addMonthsStrict(
            `${dtstart.slice(0, 8)}${String(day).padStart(2, "0")}`,
            step * rule.interval,
          );
          if (date) candidates.push(date);
        }
      }

      for (const date of candidates.sort()) {
        if (date > hardStop) continue;
        if (!push(date)) break outer;
      }
    }
    return out;
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const date = addMonthsStrict(dtstart, step * rule.interval * 12);
    if (!date) continue;
    if (date > hardStop) break;
    if (!push(date)) break;
  }
  return out;
}

// --------------------------------------------------------------------------
// Montagem
// --------------------------------------------------------------------------

interface RawEvent {
  uid: string;
  title: string;
  location: string | null;
  startsOn: IsoDate;
  /** Duracao em dias inteiros; 0 para evento que comeca e acaba no mesmo dia. */
  spanDays: number;
  allDay: boolean;
  cancelled: boolean;
  rrule: Rrule | null;
  exdates: Set<IsoDate>;
  /** Data original da ocorrencia que esta linha substitui. */
  recurrenceId: IsoDate | null;
}

function buildEvent(properties: IcsProperty[], timeZone: string): RawEvent | null {
  const first = (name: string) => properties.find((p) => p.name === name);
  const all = (name: string) => properties.filter((p) => p.name === name);

  const dtstartProperty = first("DTSTART");
  if (!dtstartProperty) return null;
  const dtstart = propertyDate(dtstartProperty, timeZone);
  if (!dtstart) return null;

  const uid = first("UID")?.value.trim() || `sem-uid-${dtstart.date}`;
  const title = unescapeText(first("SUMMARY")?.value ?? "").trim() || "(sem título)";
  const location = unescapeText(first("LOCATION")?.value ?? "").trim() || null;

  let spanDays = 0;
  const dtendProperty = first("DTEND");
  if (dtendProperty) {
    const dtend = propertyDate(dtendProperty, timeZone);
    if (dtend) {
      // Num evento de dia inteiro o DTEND e EXCLUSIVO: "1 a 5 de janeiro"
      // chega como DTEND=20260106. Guardar o dia 6 marcaria um dia de viagem
      // que nao existiu.
      const lastDay = dtstart.allDay ? addDays(dtend.date, -1) : dtend.date;
      spanDays = Math.max(0, dayNumber(lastDay) - dayNumber(dtstart.date));
    }
  } else {
    const duration = first("DURATION");
    if (duration) {
      const days = durationInDays(duration.value);
      if (days !== null) spanDays = Math.max(0, Math.ceil(days) - (dtstart.allDay ? 1 : 0));
    }
  }

  const exdates = new Set<IsoDate>();
  for (const property of all("EXDATE")) {
    for (const chunk of property.value.split(",")) {
      const parsed = propertyDate({ ...property, value: chunk }, timeZone);
      if (parsed) exdates.add(parsed.date);
    }
  }

  const recurrenceProperty = first("RECURRENCE-ID");
  const recurrenceId = recurrenceProperty
    ? (propertyDate(recurrenceProperty, timeZone)?.date ?? null)
    : null;

  const rruleProperty = first("RRULE");

  return {
    uid,
    title,
    location,
    startsOn: dtstart.date,
    spanDays,
    allDay: dtstart.allDay,
    cancelled: (first("STATUS")?.value ?? "").toUpperCase() === "CANCELLED",
    rrule: rruleProperty ? parseRrule(rruleProperty.value, timeZone) : null,
    exdates,
    recurrenceId,
  };
}

/**
 * Le um arquivo iCalendar e devolve as ocorrencias dentro da janela.
 *
 * A janela e obrigatoria de proposito: sem ela, uma serie sem fim ("todo dia,
 * para sempre") nao tem resposta finita.
 */
export function parseIcs(
  text: string,
  window: IcsWindow,
  timeZone = "America/Sao_Paulo",
): IcsResult {
  const lines = unfold(text);
  const events: RawEvent[] = [];

  let current: IcsProperty[] | null = null;
  let depth = 0;
  for (const line of lines) {
    const property = parseProperty(line);
    if (!property) continue;

    if (property.name === "BEGIN") {
      const component = property.value.trim().toUpperCase();
      if (component === "VEVENT") {
        current = [];
        depth = 0;
      } else if (current) {
        // VALARM dentro do VEVENT: as propriedades dele nao sao do evento.
        depth += 1;
      }
      continue;
    }

    if (property.name === "END") {
      const component = property.value.trim().toUpperCase();
      if (component === "VEVENT" && current) {
        const event = buildEvent(current, timeZone);
        if (event) events.push(event);
        current = null;
      } else if (current && depth > 0) {
        depth -= 1;
      }
      continue;
    }

    if (current && depth === 0) current.push(property);
  }

  // Uma linha com RECURRENCE-ID substitui uma ocorrencia especifica da serie:
  // a reuniao de terca que naquela semana mudou de dia, ou foi cancelada.
  const overrides = new Map<string, RawEvent>();
  for (const event of events) {
    if (event.recurrenceId) overrides.set(`${event.uid}|${event.recurrenceId}`, event);
  }

  const occurrences: IcsOccurrence[] = [];
  let truncated = false;

  const emit = (event: RawEvent, startsOn: IsoDate): boolean => {
    const endsOn = addDays(startsOn, event.spanDays);
    // Basta o evento ENCOSTAR na janela: uma viagem que comeca em dezembro e
    // termina em janeiro conta nos dois meses.
    if (endsOn < window.from || startsOn > window.to) return true;
    if (occurrences.length >= MAX_OCCURRENCES) {
      truncated = true;
      return false;
    }
    occurrences.push({
      uid: event.uid,
      title: event.title,
      location: event.location,
      startsOn,
      endsOn,
      allDay: event.allDay,
    });
    return true;
  };

  for (const event of events) {
    if (event.cancelled) continue;
    if (event.recurrenceId) {
      // Ja tratado como excecao da serie; so vale sozinho se a serie sumiu.
      if (events.some((e) => e.uid === event.uid && !e.recurrenceId)) continue;
      if (!emit(event, event.startsOn)) break;
      continue;
    }

    if (!event.rrule) {
      if (!emit(event, event.startsOn)) break;
      continue;
    }

    let stop = false;
    for (const date of expandRrule(event.startsOn, event.rrule, window.to)) {
      if (event.exdates.has(date)) continue;
      const override = overrides.get(`${event.uid}|${date}`);
      if (override) {
        if (override.cancelled) continue;
        if (!emit(override, override.startsOn)) {
          stop = true;
          break;
        }
        continue;
      }
      if (!emit(event, date)) {
        stop = true;
        break;
      }
    }
    if (stop) break;
  }

  return { occurrences, eventCount: events.length, truncated };
}
