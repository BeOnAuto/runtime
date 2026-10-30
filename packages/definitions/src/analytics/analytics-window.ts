import { InvalidInput, isCalendarDay } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

export const longestWindowInDays = 366;

const defaultDays = 7;

const millisecondsInADay = 86_400_000;

export const DaysField = Schema.Literals([7, 14, 30]).annotate({
  description: `The last 7, 14 or 30 days, ending today in UTC; ${defaultDays} when neither days nor from and to are given`,
});

export function dayFieldOf(description: string) {
  return Schema.String.annotate({ description }).check(
    Schema.makeFilter(isCalendarDay, {
      expected: 'a day of the calendar as YYYY-MM-DD, such as 2026-10-06',
      toJsonSchema: () => [{ format: 'date' }, true],
    }),
  );
}

export interface WindowRequest {
  readonly days?: number;
  readonly from?: string;
  readonly to?: string;
}

export interface AnalyticsWindow {
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

function dayNumberOf(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / millisecondsInADay;
}

export function dayOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function daysOf({ from, days }: AnalyticsWindow): readonly string[] {
  return Array.from({ length: days }, (_, index) => dayOf((dayNumberOf(from) + index) * millisecondsInADay));
}

function refused(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({
    detail: 'The days asked for are not a window this playbook can answer',
    issues: [{ pointer, detail }],
  });
}

function betweenDays(from: string, to: string, today: string): Effect.Effect<AnalyticsWindow, InvalidInput> {
  const days = dayNumberOf(to) - dayNumberOf(from) + 1;
  if (days < 1) {
    return Effect.fail(refused('/to', `Expected a day on or after from, ${from}`));
  }
  if (to > today) {
    return Effect.fail(refused('/to', `Expected a day no later than today, ${today}, in UTC`));
  }
  return days > longestWindowInDays
    ? Effect.fail(refused('/from', `Expected a window of at most ${longestWindowInDays} days, not ${days}`))
    : Effect.succeed({ from, to, days });
}

function lastDays(days: number, today: string): AnalyticsWindow {
  return { from: dayOf((dayNumberOf(today) - days + 1) * millisecondsInADay), to: today, days };
}

export function windowOf(
  { days, from, to }: WindowRequest,
  today: string,
): Effect.Effect<AnalyticsWindow, InvalidInput> {
  if (days !== undefined && (from !== undefined || to !== undefined)) {
    return Effect.fail(refused('/days', 'Expected days, or from and to, not both'));
  }
  if (from === undefined || to === undefined) {
    return from === to
      ? Effect.succeed(lastDays(days ?? defaultDays, today))
      : Effect.fail(refused(from === undefined ? '/from' : '/to', 'Expected from and to together'));
  }
  return betweenDays(from, to, today);
}
