import { civilDay, millisecondsInADay } from './civil-days.ts';
import { periodOfDay, type Grain } from './grains.ts';

export type Enclosing = Exclude<Grain, 'day'>;

export const enclosings: readonly Enclosing[] = ['week', 'month', 'quarter', 'year'];

const daysToMonday = 3;

const daysInAWeek = 7;

const monthsInAQuarter = 3;

const monthsInAYear = 12;

const longestSpans: Readonly<Record<Grain, Readonly<Partial<Record<Enclosing, number>>>>> = {
  day: { week: 7, month: 31, quarter: 92 },
  week: { quarter: 14, year: 53 },
  month: { quarter: 3, year: 12 },
  quarter: {},
  year: {},
};

function firstOfMonth(months: number): number {
  return civilDay({ year: Math.floor(months / monthsInAYear), month: (months % monthsInAYear) + 1, day: 1 });
}

function dayOf(grain: Grain, period: number): number {
  const days: Readonly<Record<Grain, () => number>> = {
    day: () => period,
    week: () => period * daysInAWeek,
    month: () => firstOfMonth(period),
    quarter: () => firstOfMonth(period * monthsInAQuarter),
    year: () => civilDay({ year: period, month: 1, day: 1 }),
  };
  return days[grain]();
}

function firstDayOf(grain: Grain, period: number): number {
  return grain === 'week' ? period * daysInAWeek - daysToMonday : dayOf(grain, period);
}

export function closeOf(grain: Grain, period: number): number {
  return firstDayOf(grain, period + 1) * millisecondsInADay;
}

function firstPeriodFrom(grain: Grain, day: number): number {
  return grain === 'week' ? Math.ceil(day / daysInAWeek) : periodOfDay(grain, day);
}

export function longestSpanOf(grain: Grain, enclosing: Enclosing): number | undefined {
  return longestSpans[grain][enclosing];
}

export function enclosingOf(grain: Grain, enclosing: Enclosing, period: number): number {
  return periodOfDay(enclosing, dayOf(grain, period));
}

export function periodsToTheEnd(grain: Grain, enclosing: Enclosing, origin: number): number {
  const next = enclosingOf(grain, enclosing, origin + 1);
  return firstPeriodFrom(grain, firstDayOf(enclosing, next + 1)) - 1 - origin;
}

export function startOfEnclosing(grain: Grain, enclosing: Enclosing, period: number): number {
  return firstPeriodFrom(grain, firstDayOf(enclosing, enclosingOf(grain, enclosing, period)));
}
