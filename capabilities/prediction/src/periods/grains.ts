import { civilOfDay, civilDay } from './civil-days.ts';

export type Grain = 'day' | 'week' | 'month' | 'quarter' | 'year';

export const grains: readonly Grain[] = ['day', 'week', 'month', 'quarter', 'year'];

type Parts = Readonly<Record<string, string | undefined>>;

interface GrainRule {
  readonly ofDay: (day: number) => number;
  readonly formOf: (index: number) => string;
  readonly written: RegExp;
  readonly indexOf: (parts: Parts) => number;
}

const daysBeforeTheFirstMonday = 3;

function digits(count: number, value: number): string {
  return String(value).padStart(count, '0');
}

function partOf(parts: Parts, name: string): number {
  return Number(parts[name]);
}

function weekOfDay(day: number): number {
  return Math.floor((day + daysBeforeTheFirstMonday) / 7);
}

function weekForm(index: number): string {
  const thursday = index * 7;
  const { year } = civilOfDay(thursday);
  const week = Math.floor((thursday - civilDay({ year, month: 1, day: 1 })) / 7) + 1;
  return `${digits(4, year)}-W${digits(2, week)}`;
}

function weekIndexOf(parts: Parts): number {
  const fourthOfJanuary = civilDay({ year: partOf(parts, 'year'), month: 1, day: 4 });
  return weekOfDay(fourthOfJanuary) + partOf(parts, 'week') - 1;
}

function monthsOf(day: number): number {
  const { year, month } = civilOfDay(day);
  return year * 12 + month - 1;
}

const rules: Readonly<Record<Grain, GrainRule>> = {
  day: {
    ofDay: (day) => day,
    formOf: (index) => {
      const { year, month, day } = civilOfDay(index);
      return `${digits(4, year)}-${digits(2, month)}-${digits(2, day)}`;
    },
    written: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u,
    indexOf: (parts) =>
      civilDay({ year: partOf(parts, 'year'), month: partOf(parts, 'month'), day: partOf(parts, 'day') }),
  },
  week: { ofDay: weekOfDay, formOf: weekForm, written: /^(?<year>\d{4})-W(?<week>\d{2})$/u, indexOf: weekIndexOf },
  month: {
    ofDay: monthsOf,
    formOf: (index) => `${digits(4, Math.floor(index / 12))}-${digits(2, (index % 12) + 1)}`,
    written: /^(?<year>\d{4})-(?<month>\d{2})$/u,
    indexOf: (parts) => partOf(parts, 'year') * 12 + partOf(parts, 'month') - 1,
  },
  quarter: {
    ofDay: (day) => Math.floor(monthsOf(day) / 3),
    formOf: (index) => `${digits(4, Math.floor(index / 4))}-Q${(index % 4) + 1}`,
    written: /^(?<year>\d{4})-Q(?<quarter>[1-4])$/u,
    indexOf: (parts) => partOf(parts, 'year') * 4 + partOf(parts, 'quarter') - 1,
  },
  year: {
    ofDay: (day) => civilOfDay(day).year,
    formOf: (index) => digits(4, index),
    written: /^(?<year>\d{4})$/u,
    indexOf: (parts) => partOf(parts, 'year'),
  },
};

export function periodOfDay(grain: Grain, day: number): number {
  return rules[grain].ofDay(day);
}

export function periodForm(grain: Grain, index: number): string {
  return rules[grain].formOf(index);
}

export function periodOfForm(grain: Grain, text: string): number | undefined {
  const rule = rules[grain];
  const parts = rule.written.exec(text)?.groups;
  if (parts === undefined) {
    return undefined;
  }
  const index = rule.indexOf(parts);
  return rule.formOf(index) === text ? index : undefined;
}

export function grainOfForm(text: string): Grain | undefined {
  return grains.find((grain) => rules[grain].written.test(text));
}
