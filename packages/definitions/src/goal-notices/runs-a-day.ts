import type { Trigger } from '../registry/definition-triggers.ts';

const aDay = 86_400_000;

const fieldsAfterTheHour = 3;

interface FieldRange {
  readonly low: number;
  readonly high: number;
}

const minutes: FieldRange = { low: 0, high: 59 };

const hours: FieldRange = { low: 0, high: 23 };

function numberOf(text: string): number {
  return /^\d+$/u.test(text) ? Number(text) : Number.NaN;
}

function spanOf(range: string, stepped: boolean, { low, high }: FieldRange): readonly [number, number] {
  if (range === '*') {
    return [low, high];
  }
  const [from = '', to] = range.split('-');
  const start = numberOf(from);
  return [start, to === undefined ? (stepped ? high : start) : numberOf(to)];
}

function valuesOfPart(part: string, field: FieldRange): readonly number[] {
  const [range = '', step] = part.split('/');
  const by = step === undefined ? 1 : numberOf(step);
  const [start, end] = spanOf(range, step !== undefined, field);
  if ([by, start, end].some((value) => Number.isNaN(value)) || by < 1) {
    return [Number.NaN];
  }
  return Array.from({ length: Math.max(0, Math.floor((end - start) / by) + 1) }, (_, index) => start + index * by);
}

function countOf(text: string, field: FieldRange): number {
  const values = new Set(text.split(',').flatMap((part) => valuesOfPart(part, field)));
  return [...values].some((value) => Number.isNaN(value)) ? Number.NaN : values.size;
}

function runsOf(trigger: Trigger): number {
  if (trigger.kind === 'every') {
    return Math.max(1, Math.round(aDay / trigger.milliseconds));
  }
  if (trigger.kind === 'event') {
    return 0;
  }
  const [minute = '', hour = '', ...rest] = trigger.expression.trim().split(/\s+/u);
  return rest.length === fieldsAfterTheHour ? countOf(minute, minutes) * countOf(hour, hours) : Number.NaN;
}

export function runsADayOf(triggers?: readonly Trigger[]): number | undefined {
  const runs = (triggers ?? []).reduce((total, trigger) => total + runsOf(trigger), 0);
  return Number.isNaN(runs) || runs === 0 ? undefined : runs;
}
