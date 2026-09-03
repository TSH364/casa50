import type { IsoDate, MonthKey } from "./types";

/**
 * Meses sao manipulados como string `YYYY-MM`, nunca como `Date`.
 *
 * Motivo: `new Date("2026-08-01")` e interpretado como UTC e, em fuso
 * negativo como o de Brasilia, `getMonth()` devolve julho. Um relatorio
 * mensal errado por um dia e o tipo de bug que so aparece na virada do mes.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): value is MonthKey {
  return MONTH_RE.test(value);
}

/** `"2026-08-12"` -> `"2026-08"`. */
export function monthOf(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

/** Mes corrente segundo o relogio local do usuario. */
export function currentMonth(now: Date = new Date()): MonthKey {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  const nextYear = year + Math.floor(index / 12);
  const nextMonth = ((index % 12) + 12) % 12;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
}

/** Diferenca em meses: `monthDiff("2026-08", "2026-11") === 3`. */
export function monthDiff(from: MonthKey, to: MonthKey): number {
  return (
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7)))
  );
}

/** Sequencia inclusiva de meses. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let i = 0; i <= monthDiff(from, to); i += 1) out.push(addMonths(from, i));
  return out;
}

export function daysInMonth(month: MonthKey): number {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
}

/**
 * Dias que ainda restam no mes, incluindo hoje.
 * Para um mes ja encerrado devolve 0; para um mes futuro, o mes inteiro.
 * Alimenta o "ritmo diario disponivel" da secao 7.
 */
export function daysRemaining(month: MonthKey, now: Date = new Date()): number {
  const today = currentMonth(now);
  if (month < today) return 0;
  if (month > today) return daysInMonth(month);
  return daysInMonth(month) - now.getDate() + 1;
}

/** Primeiro dia do mes como `YYYY-MM-01` - formato aceito pelo Postgres. */
export function monthToDate(month: MonthKey): IsoDate {
  return `${month}-01`;
}

const LONG = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

/** `"2026-08"` -> `"agosto de 2026"`. */
export function monthLabel(month: MonthKey): string {
  return LONG.format(new Date(`${month}-01T00:00:00Z`));
}

/** `"2026-08"` -> `"ago"`. */
export function monthShortLabel(month: MonthKey): string {
  return SHORT.format(new Date(`${month}-01T00:00:00Z`)).replace(".", "");
}
