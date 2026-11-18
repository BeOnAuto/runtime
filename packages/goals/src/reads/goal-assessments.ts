import type { Goal } from '@on.auto/definitions/goals';
import { PlaybookReader, type ProjectedCondition, type ProjectedKeyedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { markColumns } from '../goal-tables/assessment-rows.ts';
import { noticesDeliveredIn } from '../notice-deliveries/notice-deliveries.ts';
import {
  goalRowsOf,
  openRowsOf,
  type DismissedAsked,
  type GoalRows,
  type OpenRows,
  type Rows,
} from '../results/goal-rows.ts';
import { judgedDaysOf, streakOf, type DaysAsked } from '../results/judged-days.ts';
import {
  assessmentReadOf,
  closedReadsOf,
  heldAssessmentsOf,
  instantIn,
  type AssessmentRead,
  type ClosedRead,
  type HeldAssessment,
} from './assessment-read.ts';
import { mostClosedShown, mostInFlight, type Assessments } from './assessments-schema.ts';
import type { NoticesDelivered } from './notices-delivered.ts';

export type GoalsAsked = DaysAsked & DismissedAsked;

const set = Number.MIN_SAFE_INTEGER;

const open: ProjectedCondition = { column: 'open', equals: true };

const dismissedNow: ProjectedCondition = { column: 'dismissed', equals: true };

const closed: ProjectedCondition = { column: 'open', equals: false };

function heldOf(rows: Rows): readonly HeldAssessment[] {
  return rows.flatMap((row) => heldAssessmentsOf(row));
}

function dueOf(row: ProjectedKeyedRow): number {
  return instantIn(row, 'window_due', 0);
}

function openedOf(row: ProjectedKeyedRow): number {
  return instantIn(row, 'opened_at', 0);
}

function byDueThenNewest(left: ProjectedKeyedRow, right: ProjectedKeyedRow): number {
  const byDueFirst = dueOf(left) - dueOf(right);
  return byDueFirst === 0 ? openedOf(right) - openedOf(left) : byDueFirst;
}

function byDue(rows: OpenRows, where: readonly ProjectedCondition[], limit: number): Effect.Effect<Rows> {
  if (limit <= 0) {
    return Effect.succeed([]);
  }
  return Effect.flatMap(rows.read(where, ['window_due', 'opened_at'], 'asc', limit), (first) => {
    const last = first.at(-1);
    if (last === undefined || first.length < limit) {
      return Effect.succeed(first.toSorted(byDueThenNewest));
    }
    const lastDue = dueOf(last);
    const before = first.filter((row) => dueOf(row) < lastDue);
    return Effect.map(
      rows.read([...where, { column: 'window_due', equals: lastDue }], ['opened_at'], 'desc', limit - before.length),
      (tied) => [...before.toSorted(byDueThenNewest), ...tied],
    );
  });
}

function withNoWindow(rows: OpenRows, windowed: number, limit: number): Effect.Effect<Rows> {
  return Effect.map(rows.read([], ['opened_at'], 'desc', limit + windowed), (newest) =>
    newest.filter(({ row }) => row['window_due'] === null).slice(0, limit),
  );
}

function inFlightOf(rows: OpenRows, openCount: number): Effect.Effect<Rows> {
  return Effect.gen(function* () {
    if (openCount === 0) {
      return [];
    }
    const overdue = yield* byDue(rows, [{ column: 'overdue', equals: true }], mostInFlight);
    const due = yield* byDue(
      rows,
      [
        { column: 'overdue', equals: false },
        { column: 'window_due', after: set },
      ],
      mostInFlight - overdue.length,
    );
    const windowed = overdue.length + due.length;
    if (windowed >= mostInFlight || windowed === openCount) {
      return [...overdue, ...due];
    }
    const windowedCount = yield* rows.count([{ column: 'window_due', after: set }]);
    return [...overdue, ...due, ...(yield* withNoWindow(rows, windowedCount, mostInFlight - windowed))];
  });
}

function countsOf(
  ids: readonly string[],
  countOf: (id: string) => Effect.Effect<number>,
): Effect.Effect<Record<string, number>> {
  return Effect.map(
    Effect.forEach(ids, (id) => Effect.map(countOf(id), (count): readonly [string, number] => [id, count])),
    (counted: readonly (readonly [string, number])[]) => Object.fromEntries(counted),
  );
}

function markedCountOf(rows: OpenRows, milestone: string, columns: readonly string[]): Effect.Effect<number> {
  return Effect.map(
    Effect.forEach(columns, (column) => rows.count([{ column, equals: milestone }])),
    (counts: readonly number[]) => counts.reduce((total, count) => total + count, 0),
  );
}

function none(): Effect.Effect<number> {
  return Effect.succeed(0);
}

function pinnedNowBy(rows: OpenRows, openCount: number, goalsVersion: number | undefined): Effect.Effect<boolean> {
  return goalsVersion === undefined
    ? Effect.succeed(false)
    : Effect.map(rows.count([{ column: 'goals_version', equals: goalsVersion }]), (pinned) => pinned === openCount);
}

function markedBy(rows: OpenRows, ids: readonly string[], pinnedNow: boolean) {
  return (id: string) => {
    const column = markColumns[ids.indexOf(id)];
    return markedCountOf(rows, id, pinnedNow && column !== undefined ? [column] : markColumns);
  };
}

function milestoneCountsOf(rows: OpenRows, goal: Goal, openCount: number, goalsVersion: number | undefined) {
  const ids = (goal.milestones ?? []).map(({ id }) => id);
  return Effect.gen(function* () {
    if (openCount === 0 || ids.length === 0) {
      return { by_milestone: yield* countsOf(ids, none), waiting: yield* countsOf(ids, none) };
    }
    const pinnedNow = yield* pinnedNowBy(rows, openCount, goalsVersion);
    return {
      by_milestone: yield* countsOf(ids, markedBy(rows, ids, pinnedNow)),
      waiting: yield* countsOf(ids, (id) => rows.count([{ column: 'next_milestone', equals: id }])),
    };
  });
}

interface Ended {
  readonly held: HeldAssessment;
  readonly closed: ClosedRead;
}

function endedOf(rows: Rows): readonly Ended[] {
  return rows.flatMap((row) =>
    heldAssessmentsOf(row).flatMap((held) =>
      closedReadsOf(held, instantIn(row, 'closed_at', 0)).map((shown) => ({ held, closed: shown })),
    ),
  );
}

function positionAfter(rows: Rows) {
  const last = rows.at(-1);
  return last === undefined ? undefined : [instantIn(last, 'closed_at', 0), last.key];
}

function latestEndedOf(rows: GoalRows, shown: number): Effect.Effect<readonly Ended[]> {
  const page = (before: Rows, kept: readonly Ended[]): Effect.Effect<readonly Ended[]> =>
    Effect.flatMap(
      rows.readAfter([closed], ['closed_at'], 'desc', { limit: shown, after: positionAfter(before) }),
      (found) => {
        const more = [...kept, ...endedOf(found)];
        return found.length < shown || more.length >= shown ? Effect.succeed(more.slice(0, shown)) : page(found, more);
      },
    );
  return shown === 0 ? Effect.succeed([]) : page([], []);
}

function closedOf(rows: GoalRows, asked: DaysAsked) {
  return Effect.gen(function* () {
    const passed = yield* rows.count([{ column: 'outcome', equals: 'passed' }]);
    const failed = yield* rows.count([{ column: 'outcome', equals: 'failed' }]);
    const noResult = yield* rows.count([{ column: 'outcome', equals: 'no_result' }]);
    const total = passed + failed + noResult;
    const latest = yield* latestEndedOf(rows, Math.min(total, mostClosedShown));
    const days = yield* judgedDaysOf(rows, asked);
    const streak = total === 0 ? {} : yield* streakOf(rows);
    return { total, passed, failed, no_result: noResult, latest, ...days, ...streak };
  });
}

function currentOf(rows: OpenRows, latest: readonly Ended[]): Effect.Effect<HeldAssessment | undefined> {
  return Effect.gen(function* () {
    const [observed] = heldOf(yield* rows.read([{ column: 'observed_at', after: set }], ['opened_at'], 'desc', 1));
    if (observed !== undefined) {
      return observed;
    }
    const judged = latest.find(({ held }) => held.state.verdict !== 'open');
    if (judged !== undefined) {
      return judged.held;
    }
    const [newest] = heldOf(yield* rows.read([], ['opened_at'], 'desc', 1));
    return newest;
  });
}

function readOf(delivered: NoticesDelivered) {
  return (held: HeldAssessment): Effect.Effect<AssessmentRead, never, PlaybookReader> =>
    Effect.map(delivered(held.notices), (notices) => ({ ...assessmentReadOf(held), notices }));
}

export function goalAssessmentsIn(
  goal: Goal,
  delivered: NoticesDelivered = noticesDeliveredIn,
  goalsVersion?: number,
  asked: GoalsAsked = {},
): Effect.Effect<Assessments, never, PlaybookReader> {
  return Effect.gen(function* () {
    const reader = yield* PlaybookReader;
    const rows = goalRowsOf(reader, goal);
    const openRows = openRowsOf(rows, asked);
    const openCount = yield* openRows.count([]);
    const stoppedCount = openCount === 0 ? 0 : yield* openRows.count([{ column: 'stopped_at', after: set }]);
    const dismissedCount = yield* rows.count([open, dismissedNow]);
    const inFlight = heldOf(yield* inFlightOf(openRows, openCount));
    const counts = yield* milestoneCountsOf(openRows, goal, openCount, goalsVersion);
    const ended = yield* closedOf(rows, asked);
    const current = yield* currentOf(openRows, ended.latest);
    const read = readOf(delivered);
    return {
      current: current === undefined ? null : yield* read(current),
      open_count: openCount,
      stopped_count: stoppedCount,
      dismissed_count: dismissedCount,
      in_flight: yield* Effect.forEach(inFlight, read),
      ...counts,
      closed: { ...ended, latest: ended.latest.map(({ closed: shown }) => shown) },
    };
  });
}
