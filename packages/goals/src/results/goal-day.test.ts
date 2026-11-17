import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  assessmentBookOf,
  experimentsGoal,
  inTurn,
  instantText,
  type AssessmentBook,
} from '../reads/assessment-samples.ts';
import { goalsOperationsServed } from '../reads/goals-operations.ts';
import { goalDayIn, mostOnADayPage, type GoalDayAsked } from './goal-day.ts';

const minute = 60_000;

const pacific = 'America/Los_Angeles';

const nov14 = Date.parse('2026-11-14T08:00:00.000Z');

const quiet = 'Went quiet: only 9 of 14 checks reported within 3 minutes.';

async function judgedAt(book: AssessmentBook, index: number, at: number): Promise<string> {
  const id = await book.opened(experimentsGoal, at - minute, { per: `check-${String(index)}` });
  await book.observed(id, at, {
    title: `Check run ${String(index)}`,
    measurement: { value: 5, final: true, as_of: at },
    says: quiet,
  });
  await book.assessed(id, 'failed', at, 'final');
  return id;
}

async function aDayOfChecks(book: AssessmentBook) {
  await book.goalsSaved([experimentsGoal]);
  await judgedAt(book, 0, nov14 - minute);
  const judged = await inTurn(
    Array.from({ length: 23 }, (_, index) => index),
    (index) => judgedAt(book, index + 1, nov14 + index * minute),
  );
  const retired = await book.opened(experimentsGoal, nov14, { per: 'retired' });
  await book.ended(retired, 'goal_retired', nov14 + 30 * minute);
  await judgedAt(book, 99, nov14 + 24 * 60 * minute);
  return judged.toReversed();
}

function dayOf(book: AssessmentBook, asked: Partial<GoalDayAsked> = {}) {
  return book.inThePlaybook(
    Effect.orDie(goalDayIn({ goal: experimentsGoal.id, day: '2026-11-14', time_zone: pacific, ...asked })),
  );
}

async function threePagesOf(book: AssessmentBook, asked: Partial<GoalDayAsked> = {}) {
  const first = await dayOf(book, asked);
  const second = await dayOf(book, { ...asked, cursor: String(first.next_cursor) });
  const last = await dayOf(book, { ...asked, cursor: String(second.next_cursor) });
  return [first, second, last] as const;
}

describe('the judged results of one day of a goal', () => {
  it('are read newest first, ten a page, with what each was judged on, and only those of that day in the zone', async () => {
    const book = assessmentBookOf();
    const newestFirst = await aDayOfChecks(book);

    const [first, second, last] = await threePagesOf(book);

    expect(mostOnADayPage).toBe(10);
    expect(first.day).toBe('2026-11-14');
    expect(first.time_zone).toBe(pacific);
    expect([...first.items, ...second.items, ...last.items].map(({ id }) => id)).toEqual(newestFirst);
    expect(last.next_cursor).toBeNull();
    expect(first.items[0]).toMatchObject({
      outcome: 'failed',
      by: 'final',
      at: instantText(nov14 + 22 * minute),
      per: { id: 'check-23', title: 'Check run 23' },
      measurement: { value: 5, final: true, says: quiet },
    });
  });
});

describe('the pages of one day of a goal', () => {
  it('has no cursor when the last page is full and nothing is after it', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    await inTurn(
      Array.from({ length: 10 }, (_, index) => index),
      (index) => judgedAt(book, index, nov14 + index * minute),
    );

    const day = await dayOf(book);

    expect(day.items).toHaveLength(10);
    expect(day.next_cursor).toBeNull();
  });

  it('reads past the results that ended without a judgement to fill its page', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const judged = await inTurn(
      Array.from({ length: 10 }, (_, index) => index),
      (index) => judgedAt(book, index, nov14 + index * minute),
    );
    await inTurn([0, 1], async (index) => {
      const retired = await book.opened(experimentsGoal, nov14, { per: `retired-${String(index)}` });
      await book.ended(retired, 'goal_retired', nov14 + (30 + index) * minute);
    });

    const day = await dayOf(book);

    expect(day.items.map(({ id }) => id)).toEqual(judged.toReversed());
    expect(day.next_cursor).toBeNull();
  });
});

async function aMixedDay(book: AssessmentBook) {
  await book.goalsSaved([experimentsGoal]);
  const outcomes = ['passed', 'failed', 'passed', 'failed', 'passed'] as const;
  const judged = await inTurn([...outcomes], async (verdict, index) => {
    const at = nov14 + index * minute;
    const id = await book.opened(experimentsGoal, at - minute, { per: `check-${String(index)}` });
    await book.observed(id, at, { measurement: { value: 5, final: true, as_of: at } });
    await book.assessed(id, verdict, at, 'final');
    return id;
  });
  const ended = await book.opened(experimentsGoal, nov14, { per: 'ended' });
  await book.ended(ended, 'no_result', nov14 + 10 * minute);
  return { judged, ended };
}

describe('the results of one day of a goal kept to one outcome', () => {
  it('lists only the results that ended that way, newest first, each as the day lists it', async () => {
    const book = assessmentBookOf();
    const { judged, ended } = await aMixedDay(book);

    const failed = await dayOf(book, { outcome: 'failed' });
    const passed = await dayOf(book, { outcome: 'passed' });
    const noResult = await dayOf(book, { outcome: 'no_result' });
    const all = await dayOf(book);

    expect(failed.items.map(({ id }) => id)).toEqual([judged[3], judged[1]]);
    expect(failed.items.every(({ outcome }) => outcome === 'failed')).toBe(true);
    expect(passed.items.map(({ id }) => id)).toEqual([judged[4], judged[2], judged[0]]);
    expect(noResult.items).toEqual([expect.objectContaining({ id: ended, outcome: 'no_result' })]);
    expect(failed.items[0]).toEqual(all.items.find(({ id }) => id === judged[3]));
    expect([failed.next_cursor, passed.next_cursor, noResult.next_cursor]).toEqual([null, null, null]);
  });

  it('pages ten at a time through the results of that outcome alone', async () => {
    const book = assessmentBookOf();
    const newestFirst = await aDayOfChecks(book);

    const [first, second, last] = await threePagesOf(book, { outcome: 'failed' });
    const passed = await dayOf(book, { outcome: 'passed' });

    expect([...first.items, ...second.items, ...last.items].map(({ id }) => id)).toEqual(newestFirst);
    expect(last.next_cursor).toBeNull();
    expect(passed).toEqual({ day: '2026-11-14', time_zone: pacific, items: [], next_cursor: null });
  });
});

describe('a day of a goal with nothing to read', () => {
  it('is empty on a day nothing was judged, and refuses a goal the playbook does not hold', async () => {
    const book = assessmentBookOf();
    await aDayOfChecks(book);

    const empty = await dayOf(book, { day: '2026-11-12' });
    const missing = await book.inThePlaybook(
      Effect.orDie(Effect.flip(goalDayIn({ goal: 'no-such-goal', day: '2026-11-14', time_zone: pacific }))),
    );

    expect(empty).toEqual({ day: '2026-11-12', time_zone: pacific, items: [], next_cursor: null });
    expect(missing.detail).toBe('There is no goal no-such-goal in this playbook');
  });
});

describe('the day of a goal as an operation', () => {
  it('is served over HTTP alone beside the goals read', () => {
    const [, , day] = goalsOperationsServed(true);

    expect(day?.registration).toMatchObject({
      name: 'get_goal_day',
      scope: 'playbook',
      route: { method: 'GET', path: '/goals/{goal}/days/{day}' },
      servedOverHttpAlone: { kind: 'none' },
    });
  });
});
