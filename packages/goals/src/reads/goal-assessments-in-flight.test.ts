import { PlaybookReader, type ProjectedCondition } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  afterSpan,
  assessmentBookOf,
  day,
  experimentsGoal,
  firstDay,
  inTurn,
  instantText,
  thingAt,
  type AssessmentBook,
} from './assessment-samples.ts';
import { goalAssessmentsIn } from './goal-assessments.ts';
import type { NoticesDelivered } from './notices-delivered.ts';

const hour = 3_600_000;

function read(book: AssessmentBook) {
  return book.inThePlaybook(goalAssessmentsIn(experimentsGoal));
}

interface Due {
  readonly id: string;
  readonly liveDay: number;
  readonly opened: number;
}

function dueThenNewest(left: Readonly<Due>, right: Readonly<Due>): number {
  const byDay = left.liveDay - right.liveDay;
  return byDay === 0 ? right.opened - left.opened : byDay;
}

function dueOnDays(book: AssessmentBook, liveDays: readonly number[]): Promise<readonly Due[]> {
  return inTurn(liveDays, async (liveDay, index) => {
    const opened = firstDay + (index + 1) * hour;
    const id = await thingAt(book, {
      per: `MAR-${String(index)}`,
      at: opened,
      marked: ['live'],
      live: firstDay + liveDay * day,
    });
    return { id, liveDay, opened };
  });
}

describe('the open assessments of a goal judged thing by thing', () => {
  it('are counted by the milestones they have marked and the milestone each waits on next', async () => {
    const book = assessmentBookOf();
    const chosen = await thingAt(book, { per: 'MAR-41', at: firstDay, marked: ['chosen'], live: 0 });
    const prepared = await thingAt(book, {
      per: 'MAR-42',
      at: firstDay + hour,
      marked: ['chosen', 'prepared'],
      live: 0,
    });
    const live = await thingAt(book, {
      per: 'MAR-43',
      at: firstDay + 2 * hour,
      marked: ['chosen', 'prepared', 'live'],
      live: firstDay + day,
    });

    const assessments = await read(book);

    expect(assessments.open_count).toBe(3);
    expect(assessments.by_milestone).toEqual({ chosen: 3, prepared: 2, live: 1, measured: 0 });
    expect(assessments.waiting).toEqual({ chosen: 0, prepared: 1, live: 1, measured: 1 });
    expect(assessments.in_flight.map(({ id }) => id)).toEqual([live, prepared, chosen]);
    expect(assessments.in_flight.map(({ next }) => next)).toEqual(['measured', 'live', 'prepared']);
    expect(assessments.current?.id).toBe(live);
    expect(assessments.closed).toEqual({ total: 0, passed: 0, failed: 0, no_result: 0, latest: [] });
  });

  it('are listed after every one that has a due when they have no window yet, the newest first', async () => {
    const book = assessmentBookOf();
    const due = await thingAt(book, { per: 'MAR-1', at: firstDay, marked: ['live'], live: firstDay });
    const older = await thingAt(book, { per: 'MAR-2', at: firstDay + hour, marked: ['chosen'], live: 0 });
    const newer = await thingAt(book, { per: 'MAR-3', at: firstDay + 2 * hour, marked: ['chosen'], live: 0 });
    const later = await thingAt(book, {
      per: 'MAR-4',
      at: firstDay + 3 * hour,
      marked: ['live'],
      live: firstDay + day,
    });

    expect((await read(book)).in_flight.map(({ id }) => id)).toEqual([due, later, newer, older]);
  });
});

describe('the assessments in flight', () => {
  it('are at most twelve: the overdue first, then by due, then the newest of those due together', async () => {
    const book = assessmentBookOf();
    const overdue = await thingAt(book, {
      per: 'MAR-90',
      at: firstDay,
      marked: ['chosen', 'live'],
      live: firstDay + 9 * day,
    });
    await book.overdue(overdue, firstDay + 18 * day);
    const dues = await dueOnDays(book, [3, 1, 1, 1, 2, 2, 5, 5, 5, 5, 5, 5, 5, 4]);
    await thingAt(book, { per: 'MAR-99', at: firstDay + 20 * hour, marked: ['chosen'], live: 0 });
    const expected = dues.toSorted(dueThenNewest).slice(0, 11);

    const assessments = await read(book);

    expect(assessments.open_count).toBe(16);
    expect(assessments.in_flight.map(({ id }) => id)).toEqual([overdue, ...expected.map(({ id }) => id)]);
    expect(assessments.in_flight[0]?.overdue_since).toBe(instantText(firstDay + 18 * day));
  });

  it('are only overdue ones when twelve or more are overdue', async () => {
    const book = assessmentBookOf();
    const overdue = await inTurn(
      Array.from({ length: 13 }, (_, index) => index),
      async (index) => {
        const at = firstDay + index * hour;
        const id = await thingAt(book, {
          per: `MAR-${String(index)}`,
          at,
          marked: ['live'],
          live: firstDay + index * day,
        });
        await book.overdue(id, firstDay + (index + 9) * day);
        return id;
      },
    );
    await thingAt(book, { per: 'MAR-99', at: firstDay, marked: ['live'], live: firstDay });

    expect((await read(book)).in_flight.map(({ id }) => id)).toEqual(overdue.slice(0, 12));
  });
});

const delivered: NoticesDelivered = (notices) =>
  Effect.succeed(notices.map((notice) => ({ ...notice, delivered: true })));

async function overdueExperiment(book: AssessmentBook, live: number): Promise<string> {
  const id = await book.opened(experimentsGoal, firstDay, { per: 'MAR-41' });
  await book.observed(id, firstDay, { marks: 'chosen', title: 'Pricing page test', link: 'https://example.com/41' });
  await book.observed(id, live, { marks: 'live', says: 'It went live on Tuesday', window: afterSpan(live) });
  await book.observed(id, live + 6 * day, { measurement: { value: 0, final: true, as_of: live + 6 * day } });
  await book.observed(id, live + 7 * day + hour, {
    measurement: { value: 0, final: false, as_of: live + 7 * day + hour },
    says: 'No customer yet',
  });
  await book.overdue(id, live + 8 * day);
  await book.noticeStarted(id, 'overdue', live + 8 * day + 1000);
  return id;
}

function measurementsRead(live: number) {
  return {
    measurement: {
      value: 0,
      final: true,
      as_of: instantText(live + 6 * day),
      at: instantText(live + 6 * day),
      run: 'run-3',
    },
    final_measurement: { value: 0, as_of: instantText(live + 6 * day), at: instantText(live + 6 * day), run: 'run-3' },
  };
}

function overdueExperimentRead(id: string, live: number) {
  return {
    id,
    per: { id: 'MAR-41', title: 'Pricing page test', link: 'https://example.com/41' },
    window: { opens: instantText(live), closes: instantText(live + 7 * day), due: instantText(live + 8 * day) },
    rule: { settles: 'on_crossing', target: { at_least: 1 } },
    milestones: experimentsGoal.milestones,
    marks: [
      { milestone: 'chosen', at: instantText(firstDay), run: 'run-1' },
      { milestone: 'live', at: instantText(live), run: 'run-2', says: 'It went live on Tuesday' },
    ],
    next: 'prepared',
    ...measurementsRead(live),
    verdict: 'open',
    overdue_since: instantText(live + 8 * day),
    goals_version: 1,
    notices: [{ change: 'overdue', at: instantText(live + 8 * day + 1000), run: 'notice-overdue', delivered: true }],
  };
}

describe('one assessment as the goals read answers it', () => {
  it('carries its thing, window, rule, milestones, marks, next, both measurements, verdict and notices', async () => {
    const book = assessmentBookOf();
    const live = firstDay + day;
    const id = await overdueExperiment(book, live);

    const { in_flight: inFlight } = await book.inThePlaybook(goalAssessmentsIn(experimentsGoal, delivered));

    expect(inFlight).toEqual([overdueExperimentRead(id, live)]);
  });

  it('answers a verdict with when it was given, and no next milestone once every one is marked', async () => {
    const book = assessmentBookOf();
    const marked = ['chosen', 'prepared', 'live', 'measured'];
    const id = await thingAt(book, { per: 'MAR-41', at: firstDay, marked, live: firstDay });
    await book.assessed(id, 'passed', firstDay + day);

    const { current } = await read(book);

    expect(current).toMatchObject({ id, verdict: 'passed', verdict_at: instantText(firstDay + day), notices: [] });
    expect(current).not.toHaveProperty('next');
    expect(current).not.toHaveProperty('measurement');
  });
});

function countedIn(book: AssessmentBook, goalsVersion?: number) {
  return book.inThePlaybook(
    Effect.gen(function* () {
      const reader = yield* PlaybookReader;
      const counted: string[] = [];
      const assessments = yield* Effect.provideService(
        goalAssessmentsIn(experimentsGoal, undefined, goalsVersion),
        PlaybookReader,
        {
          ...reader,
          countProjectedRows: (name: string, where: readonly ProjectedCondition[]) => {
            counted.push(where.map(({ column }) => column).join(' '));
            return reader.countProjectedRows(name, where);
          },
        },
      );
      return { counts: [assessments.by_milestone, assessments.waiting], counted };
    }),
  );
}

const markCounts = (counted: readonly string[]) => counted.filter((columns) => /mark_/u.test(columns)).length;

describe('the open assessments of a goal counted by milestone', () => {
  it('count each milestone on the one column it is pinned to when every one is pinned to the goals read', async () => {
    const book = assessmentBookOf();
    await thingAt(book, { per: 'MAR-41', at: firstDay, marked: ['chosen'], live: 0 });
    await thingAt(book, { per: 'MAR-42', at: firstDay + hour, marked: ['chosen', 'prepared'], live: 0 });

    const [pinned, older, unknown] = [await countedIn(book, 1), await countedIn(book, 2), await countedIn(book)];

    expect(pinned.counts).toEqual([
      { chosen: 2, prepared: 1, live: 0, measured: 0 },
      { chosen: 0, prepared: 1, live: 1, measured: 0 },
    ]);
    expect([older.counts, unknown.counts]).toEqual([pinned.counts, pinned.counts]);
    expect([markCounts(pinned.counted), markCounts(older.counted), markCounts(unknown.counted)]).toEqual([4, 28, 28]);
  });
});
