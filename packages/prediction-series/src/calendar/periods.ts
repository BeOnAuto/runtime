import type { Enclosing, Grain } from '@on.auto/prediction-contract';

const daysInAnEra = 146_097;

const yearsInAnEra = 400;

const daysFromMarchToTheEpoch = 719_468;

const daysInAWeek = 7;

const daysToMonday = 3;

const monthsInAQuarter = 3;

const monthsInAYear = 12;

interface CivilDate {
  readonly year: number;
  readonly month: number;
}

function civilDay(year: number, month: number): number {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / yearsInAnEra);
  const yearOfEra = shifted - era * yearsInAnEra;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5);
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * daysInAnEra + dayOfEra - daysFromMarchToTheEpoch;
}

function civilOfDay(days: number): CivilDate {
  const shifted = days + daysFromMarchToTheEpoch;
  const era = Math.floor(shifted / daysInAnEra);
  const dayOfEra = shifted - era * daysInAnEra;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  return { year: yearOfEra + era * yearsInAnEra + (month <= 2 ? 1 : 0), month };
}

function monthsOf(day: number): number {
  const { year, month } = civilOfDay(day);
  return year * monthsInAYear + month - 1;
}

function firstOfMonth(months: number): number {
  return civilDay(Math.floor(months / monthsInAYear), (months % monthsInAYear) + 1);
}

function periodOfDay(grain: Grain, day: number): number {
  const periods: Readonly<Record<Grain, () => number>> = {
    day: () => day,
    week: () => Math.floor((day + daysToMonday) / daysInAWeek),
    month: () => monthsOf(day),
    quarter: () => Math.floor(monthsOf(day) / monthsInAQuarter),
    year: () => civilOfDay(day).year,
  };
  return periods[grain]();
}

function dayOf(grain: Grain, period: number): number {
  const days: Readonly<Record<Grain, () => number>> = {
    day: () => period,
    week: () => period * daysInAWeek,
    month: () => firstOfMonth(period),
    quarter: () => firstOfMonth(period * monthsInAQuarter),
    year: () => civilDay(period, 1),
  };
  return days[grain]();
}

function firstDayOf(grain: Grain, period: number): number {
  return grain === 'week' ? period * daysInAWeek - daysToMonday : dayOf(grain, period);
}

function firstPeriodFrom(grain: Grain, day: number): number {
  return grain === 'week' ? Math.ceil(day / daysInAWeek) : periodOfDay(grain, day);
}

export function periodsSoFar(grain: Grain, enclosing: Enclosing, origin: number): number {
  const next = origin + 1;
  const enclosingNext = periodOfDay(enclosing, dayOf(grain, next));
  return next - firstPeriodFrom(grain, firstDayOf(enclosing, enclosingNext));
}

export type Marks = 'day-of-week' | 'month-of-year' | 'quarter-of-year' | 'none';

const marksOfGrains: Readonly<Record<Grain, Marks>> = {
  day: 'day-of-week',
  week: 'none',
  month: 'month-of-year',
  quarter: 'quarter-of-year',
  year: 'none',
};

const marksInACycle: Readonly<Record<Marks, number>> = {
  'day-of-week': daysInAWeek,
  'month-of-year': monthsInAYear,
  'quarter-of-year': 4,
  none: 1,
};

export function marksOf(grain: Grain): Marks {
  return marksOfGrains[grain];
}

export function markColumns(marks: Marks): number {
  return marksInACycle[marks] - 1;
}

function placeInTheCycle(marks: Marks, period: number): number {
  const cycle = marksInACycle[marks];
  const shifted = marks === 'day-of-week' ? period + daysToMonday : period;
  return ((shifted % cycle) + cycle) % cycle;
}

export function markedColumns(marks: Marks, period: number): readonly number[] {
  const place = placeInTheCycle(marks, period);
  return Array.from({ length: markColumns(marks) }, (_, column) => (column + 1 === place ? 1 : 0));
}
