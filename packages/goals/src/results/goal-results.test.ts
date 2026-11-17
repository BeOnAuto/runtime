import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  assessmentBookOf,
  day,
  experimentsGoal,
  inTurn,
  instantText,
  type AssessmentBook,
} from '../reads/assessment-samples.ts';
import { goalsOperationsServed } from '../reads/goals-operations.ts';
import { mostOnADayPage } from './goal-day.ts';
import { goalResultsIn, type GoalResultsAsked } from './goal-results.ts';

const minute = 60_000;

const nov10 = Date.parse('2026-11-10T08:00:00.000Z');

const missed = 'Only 9 of 14 checks reported.';

type Ended = 'passed' | 'failed' | 'no_result';

async function endedAt(book: AssessmentBook, index: number, at: number, outcome: Ended): Promise<string> {
  const id = await book.opened(experimentsGoal, at - minute, { per: `check-${String(index)}` });
  if (outcome === 'no_result') {
    await book.ended(id, 'no_result', at);
    return id;
  }
  await book.observed(id, at, {
    title: `Check run ${String(index)}`,
    measurement: { value: outcome === 'passed' ? 14 : 9, final: true, as_of: at },
    says: outcome === 'passed' ? 'All 14 checks reported.' : missed,
  });
  await book.assessed(id, outcome, at, 'final');
  return id;
}

const pattern: readonly Ended[] = ['passed', 'passed', 'failed', 'passed', 'no_result', 'passed', 'failed'];

async function aWeekOfResults(
  book: AssessmentBook,
): Promise<readonly { readonly id: string; readonly outcome: Ended }[]> {
  await book.goalsSaved([experimentsGoal]);
  const ended = await inTurn(
    Array.from({ length: 28 }, (_, index) => index),
    async (index) => {
      const outcome = pattern[index % pattern.length] ?? 'passed';
      return { id: await endedAt(book, index, nov10 + index * (day / 4), outcome), outcome };
    },
  );
  const retired = await book.opened(experimentsGoal, nov10, { per: 'retired' });
  await book.ended(retired, 'goal_retired', nov10 + day);
  return ended.toReversed();
}

function resultsOf(book: AssessmentBook, asked: Partial<GoalResultsAsked> = {}) {
  return book.inThePlaybook(Effect.orDie(goalResultsIn({ goal: experimentsGoal.id, ...asked })));
}

async function everyPageOf(
  book: AssessmentBook,
  asked: Partial<GoalResultsAsked> = {},
  read: readonly string[] = [],
): Promise<readonly string[]> {
  const page = await resultsOf(book, asked);
  const ids = [...read, ...page.items.map(({ id }) => id)];
  return page.next_cursor === null ? ids : everyPageOf(book, { ...asked, cursor: page.next_cursor }, ids);
}

describe('the results of a goal kept to one outcome, across every day', () => {
  it('lists the misses alone, newest first, ten a page, each with what it was judged on', async () => {
    const book = assessmentBookOf();
    const newestFirst = await aWeekOfResults(book);
    const failed = newestFirst.filter(({ outcome }) => outcome === 'failed').map(({ id }) => id);

    const first = await resultsOf(book, { outcome: 'failed' });

    expect(first.items.map(({ id }) => id)).toEqual(failed);
    expect(first.next_cursor).toBeNull();
    expect(first.items[0]).toMatchObject({
      outcome: 'failed',
      by: 'final',
      at: instantText(nov10 + 27 * (day / 4)),
      per: { id: 'check-27', title: 'Check run 27' },
      measurement: { value: 9, final: true, says: missed },
    });
  });

  it('pages through the passes and through those with no result, and through everything when no outcome is asked', async () => {
    const book = assessmentBookOf();
    const newestFirst = await aWeekOfResults(book);
    const of = (outcome: Ended) => newestFirst.filter((each) => each.outcome === outcome).map(({ id }) => id);

    const firstPassed = await resultsOf(book, { outcome: 'passed' });

    expect(firstPassed.items).toHaveLength(mostOnADayPage);
    expect(firstPassed.next_cursor).not.toBeNull();
    expect(await everyPageOf(book, { outcome: 'passed' })).toEqual(of('passed'));
    expect(await everyPageOf(book, { outcome: 'no_result' })).toEqual(of('no_result'));
    expect(await everyPageOf(book)).toEqual(newestFirst.map(({ id }) => id));
  });
});

describe('the results of a goal with nothing to read', () => {
  it('are empty for a goal that ended nothing, and refuse a goal the playbook does not hold', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);

    const empty = await resultsOf(book, { outcome: 'failed' });
    const missing = await book.inThePlaybook(
      Effect.orDie(Effect.flip(goalResultsIn({ goal: 'no-such-goal', outcome: 'failed' }))),
    );

    expect(empty).toEqual({ items: [], next_cursor: null });
    expect(missing.detail).toBe('There is no goal no-such-goal in this playbook');
  });
});

describe('the results of a goal as an operation', () => {
  it('is served over HTTP alone beside the day of a goal', () => {
    const [, , , results] = goalsOperationsServed(true);

    expect(results?.registration).toMatchObject({
      name: 'list_goal_results',
      scope: 'playbook',
      route: { method: 'GET', path: '/goals/{goal}/results' },
      servedOverHttpAlone: { kind: 'none' },
    });
  });
});
