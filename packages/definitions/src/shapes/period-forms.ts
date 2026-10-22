import type { Schema } from 'effect';

export const grains = ['day', 'week', 'month', 'quarter', 'year'] as const;

type SeriesGrain = (typeof grains)[number];

export interface Timeline {
  readonly words: string;
  readonly momentOf: (at: string) => number | undefined;
}

type Moment = (year: number, second: number, third: number, at: string) => number | undefined;

interface Form {
  readonly pattern: Readonly<RegExp>;
  readonly words: string;
  readonly moment: Moment;
}

const daysOfMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const thursday = 4;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isDayOf(year: number, month: number, day: number): boolean {
  const days = Number(daysOfMonths[month - 1]) + (month === 2 && isLeap(year) ? 1 : 0);
  return day <= days;
}

function weekdayOf(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCDay();
}

function weeksIn(year: number): number {
  return weekdayOf(year, 1, 1) === thursday || weekdayOf(year, 12, 31) === thursday ? 53 : 52;
}

function dayMoment(year: number, month: number, day: number): number | undefined {
  return isDayOf(year, month, day) ? year * 10_000 + month * 100 + day : undefined;
}

function weekMoment(year: number, week: number): number | undefined {
  return week <= weeksIn(year) ? year * 100 + week : undefined;
}

function instantMoment(year: number, month: number, day: number, at: string): number | undefined {
  return isDayOf(year, month, day) ? Date.parse(at) : undefined;
}

function counting(scale: number): Moment {
  return (year, part) => year * scale + part;
}

function yearMoment(year: number): number {
  return year;
}

const forms: Readonly<Record<SeriesGrain, Form>> = {
  day: {
    pattern: /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u,
    words: 'a day in the form YYYY-MM-DD',
    moment: dayMoment,
  },
  week: { pattern: /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/u, words: 'a week in the form YYYY-Www', moment: weekMoment },
  month: { pattern: /^(\d{4})-(0[1-9]|1[0-2])$/u, words: 'a month in the form YYYY-MM', moment: counting(100) },
  quarter: { pattern: /^(\d{4})-Q([1-4])$/u, words: 'a quarter in the form YYYY-Qn', moment: counting(10) },
  year: { pattern: /^(\d{4})$/u, words: 'a year in the form YYYY', moment: yearMoment },
};

const instant: Form = {
  pattern:
    /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u,
  words: 'an RFC 3339 date and time, such as 2026-10-15T09:30:00Z',
  moment: instantMoment,
};

function timelineOf({ pattern, words, moment }: Form): Timeline {
  return {
    words,
    momentOf: (at) => {
      const parts = pattern.exec(at);
      return parts === null ? undefined : moment(Number(parts[1]), Number(parts[2]), Number(parts[3]), at);
    },
  };
}

const instants = timelineOf(instant);

const periods: ReadonlyMap<string, Timeline> = new Map(grains.map((grain) => [grain, timelineOf(forms[grain])]));

export function timelineIn(period: Schema.Json | undefined): Timeline | undefined {
  if (period === undefined) {
    return instants;
  }
  return typeof period === 'string' ? periods.get(period) : undefined;
}
