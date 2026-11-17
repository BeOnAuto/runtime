import type { ProjectedCondition, ProjectedKeyedRow } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import { textOf } from '../assessments/assessment-state.ts';
import { closedReadsOf, heldAssessmentsOf, instantIn, judgedOnItsMeasurement } from '../reads/assessment-read.ts';
import type { GoalRows, Rows } from './goal-rows.ts';
import { judgedCountOf, judgedEndOf, judgedOutcomes, missedOutcomes } from './judged-ends.ts';
import { dayHolding, zoneDaysBack, type ZoneDay } from './zone-days.ts';

export const defaultDays = 7;

export const mostDays = 31;

export interface DaysAsked {
  readonly time_zone?: string;
  readonly days?: number;
  readonly until?: string;
}

interface DayCount {
  readonly day: string;
  readonly judged: number;
  readonly passed: number;
  readonly says?: string;
}

export interface JudgedDays {
  readonly time_zone: string;
  readonly counts: readonly DayCount[];
}

export interface Streak {
  readonly last_passed?: { readonly id: string; readonly at: string };
  readonly misses_since?: { readonly at: string; readonly count: number };
}

const saysPage = 20;

const saysPagesRead = 5;

function measuredSaysOf(row: ProjectedKeyedRow): string | undefined {
  return heldAssessmentsOf(row)
    .filter((held) => judgedOnItsMeasurement(held))
    .flatMap((held) => closedReadsOf(held, 0))
    .map(({ measurement }) => measurement?.says)
    .find((says) => says !== undefined);
}

function saysOf(
  rows: GoalRows,
  where: readonly ProjectedCondition[],
  after?: Rows,
  pages = 0,
): Effect.Effect<{ readonly says?: string }> {
  const last = after?.at(-1);
  const position = last === undefined ? undefined : [instantIn(last, 'closed_at', 0), last.key];
  return Effect.flatMap(
    rows.readAfter(where, ['closed_at'], 'desc', { limit: saysPage, after: position }),
    (found: Rows) => {
      const says = found.map((row) => measuredSaysOf(row)).find((each) => each !== undefined);
      if (says !== undefined) {
        return Effect.succeed({ says });
      }
      return found.length < saysPage || pages + 1 >= saysPagesRead
        ? Effect.succeed({})
        : saysOf(rows, where, found, pages + 1);
    },
  );
}

function dayCountOf(rows: GoalRows, { day, start, end }: ZoneDay): Effect.Effect<DayCount> {
  const between = { after: start - 1, before: end };
  const where: readonly ProjectedCondition[] = [
    { column: 'open', equals: false },
    { column: 'closed_at', after: start - 1 },
    { column: 'closed_at', before: end },
  ];
  return Effect.gen(function* () {
    const passed = yield* judgedCountOf(rows, ['passed'], between);
    const judged = passed + (yield* judgedCountOf(rows, missedOutcomes, between));
    return { day, judged, passed, ...(judged === 0 ? {} : yield* saysOf(rows, where)) };
  });
}

function daysIn(rows: GoalRows, timeZone: string, asked: DaysAsked): Effect.Effect<JudgedDays> {
  return Effect.gen(function* () {
    const first = yield* judgedEndOf(rows, judgedOutcomes, {}, 'asc');
    if (first === undefined) {
      return { time_zone: timeZone, counts: [] };
    }
    const until = asked.until ?? dayHolding(timeZone, yield* Clock.currentTimeMillis);
    const days = zoneDaysBack(timeZone, until, asked.days ?? defaultDays).filter(({ end }) => end > first.at);
    return { time_zone: timeZone, counts: yield* Effect.forEach(days, (day) => dayCountOf(rows, day)) };
  });
}

export function judgedDaysOf(rows: GoalRows, asked: DaysAsked): Effect.Effect<{ readonly days?: JudgedDays }> {
  const timeZone = asked.time_zone;
  return timeZone === undefined ? Effect.succeed({}) : Effect.map(daysIn(rows, timeZone, asked), (days) => ({ days }));
}

export function streakOf(rows: GoalRows): Effect.Effect<Streak> {
  return Effect.gen(function* () {
    const passed = yield* judgedEndOf(rows, ['passed'], {}, 'desc');
    const since = passed === undefined ? {} : { after: passed.at };
    const count = yield* judgedCountOf(rows, missedOutcomes, since);
    const first = count === 0 ? undefined : yield* judgedEndOf(rows, missedOutcomes, since, 'asc');
    return {
      ...(passed === undefined ? {} : { last_passed: { id: passed.row.key, at: textOf(passed.at) } }),
      ...(first === undefined ? {} : { misses_since: { at: textOf(first.at), count } }),
    };
  });
}
