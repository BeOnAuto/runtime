import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  type AssessmentBook,
  assessmentBookOf,
  experimentsGoal,
  heldGoalOf,
  instantText,
} from '../reads/assessment-samples.ts';
import { goalAssessmentsIn, type GoalsAsked } from '../reads/goal-assessments.ts';
import { zoneDayOf } from './zone-days.ts';

const hour = 3_600_000;

const pacific = 'America/Los_Angeles';

const nov13 = Date.parse('2026-11-13T08:00:00.000Z');

const nov14 = Date.parse('2026-11-14T08:00:00.000Z');

const nov16 = Date.parse('2026-11-16T08:00:00.000Z');

interface Judged {
  readonly per: string;
  readonly at: number;
  readonly verdict: 'passed' | 'failed';
  readonly says?: string;
}

async function judged(book: AssessmentBook, { per, at, verdict, says }: Judged): Promise<string> {
  const id = await book.opened(experimentsGoal, at - hour, { per });
  await book.observed(id, at, {
    title: `Check ${per}`,
    measurement: { value: verdict === 'passed' ? 1 : 0, final: true, as_of: at },
    ...(says === undefined ? {} : { says }),
  });
  await book.assessed(id, verdict, at, 'final');
  return id;
}

async function ended(book: AssessmentBook, per: string, reason: 'no_result' | 'goal_retired', at: number) {
  const id = await book.opened(experimentsGoal, at - hour, { per });
  await book.ended(id, reason, at);
  return id;
}

async function fourDays(book: AssessmentBook) {
  await judged(book, { per: 'c-1', at: nov13 + hour, verdict: 'passed', says: 'All 14 reported.' });
  await judged(book, { per: 'c-2', at: nov13 + 2 * hour, verdict: 'failed', says: 'One check failed.' });
  const lastPass = await judged(book, { per: 'c-3', at: nov13 + 23 * hour, verdict: 'passed', says: 'All held.' });
  await judged(book, { per: 'c-4', at: nov14 + hour, verdict: 'failed', says: 'Went quiet.' });
  await ended(book, 'c-5', 'no_result', nov14 + 3 * hour);
  await ended(book, 'c-6', 'goal_retired', nov14 + 4 * hour);
  await judged(book, { per: 'c-7', at: nov16 + 5 * hour, verdict: 'failed', says: 'Went quiet again.' });
  return { lastPass };
}

function closedAsked(book: AssessmentBook, asked: GoalsAsked = {}, now = nov16 + 20 * hour) {
  return book.inThePlaybook(
    Effect.gen(function* () {
      yield* TestClock.setTime(now);
      return (yield* goalAssessmentsIn(heldGoalOf(experimentsGoal), undefined, asked)).closed;
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

describe('a day in a time zone', () => {
  it('runs from its midnight to the next, twenty-five hours on the day the clocks go back', () => {
    expect(zoneDayOf(pacific, '2026-11-01')).toEqual({
      day: '2026-11-01',
      start: Date.parse('2026-11-01T07:00:00.000Z'),
      end: Date.parse('2026-11-02T08:00:00.000Z'),
    });
  });
});

describe('the days of a goal judged thing by thing', () => {
  it('count what was judged and what passed each day in the time zone asked, newest first, with the evidence of the latest judged on its measurement, past an ending with no result', async () => {
    const book = assessmentBookOf();
    await fourDays(book);

    const { days } = await closedAsked(book, { time_zone: pacific, until: '2026-11-16' });

    expect(days).toEqual({
      time_zone: pacific,
      counts: [
        { day: '2026-11-16', judged: 1, passed: 0, says: 'Went quiet again.' },
        { day: '2026-11-15', judged: 0, passed: 0 },
        { day: '2026-11-14', judged: 2, passed: 0, says: 'Went quiet.' },
        { day: '2026-11-13', judged: 3, passed: 2, says: 'All held.' },
      ],
    });
  });

  it('move with the time zone, so the same items fall on other days in UTC', async () => {
    const book = assessmentBookOf();
    await fourDays(book);

    const { days } = await closedAsked(book, { time_zone: 'UTC', until: '2026-11-16' });

    expect(days?.counts.map(({ day, judged: count, passed }) => [day, count, passed])).toEqual([
      ['2026-11-16', 1, 0],
      ['2026-11-15', 0, 0],
      ['2026-11-14', 3, 1],
      ['2026-11-13', 2, 1],
    ]);
  });
});

async function judgedAtItsDeadline(book: AssessmentBook, per: string, at: number, says: string): Promise<string> {
  const id = await book.opened(experimentsGoal, at - hour, { per });
  await book.observed(id, at - hour / 2, {
    title: `Check ${per}`,
    measurement: { value: 0, final: false, as_of: at - hour / 2 },
    says,
  });
  await book.assessed(id, 'failed', at, 'deadline');
  return id;
}

describe('the sentence of a day', () => {
  it('is the one of the latest judged that day on a final measurement, never an earlier reading of one judged at its deadline', async () => {
    const book = assessmentBookOf();
    await judged(book, {
      per: 'c-1',
      at: nov14 + hour,
      verdict: 'failed',
      says: 'Went quiet: only 9 of 14 checks reported.',
    });
    await judgedAtItsDeadline(book, 'c-2', nov14 + 2 * hour, '9 of 14 checks reported, 0 failed.');
    await judgedAtItsDeadline(book, 'c-3', nov16 + hour, '6 of 14 checks reported, 0 failed.');

    const { days } = await closedAsked(book, { time_zone: pacific, until: '2026-11-16' });

    expect(days?.counts).toEqual([
      { day: '2026-11-16', judged: 1, passed: 0 },
      { day: '2026-11-15', judged: 0, passed: 0 },
      { day: '2026-11-14', judged: 2, passed: 0, says: 'Went quiet: only 9 of 14 checks reported.' },
    ]);
  });
});

function deadlinesAfter(book: AssessmentBook, count: number): Promise<unknown> {
  return Array.from({ length: count }, (_, index) => index + 1).reduce<Promise<unknown>>(
    (before, minute) =>
      before.then(() =>
        judgedAtItsDeadline(book, `c-${String(minute)}`, nov14 + 2 * hour + minute * 60_000, 'Still reporting.'),
      ),
    Promise.resolve(),
  );
}

describe('the sentence of a busy day', () => {
  it('reads back past a page of things judged at their deadline to the latest judged on its measurement', async () => {
    const book = assessmentBookOf();
    await judged(book, { per: 'c-0', at: nov14 + hour, verdict: 'failed', says: 'Went quiet.' });
    await deadlinesAfter(book, 25);

    const { days } = await closedAsked(book, { time_zone: pacific, until: '2026-11-14', days: 1 });

    expect(days?.counts).toEqual([{ day: '2026-11-14', judged: 26, passed: 0, says: 'Went quiet.' }]);
  });

  it('serves no sentence where the latest hundred were all judged at their deadline', async () => {
    const book = assessmentBookOf();
    await judged(book, { per: 'c-0', at: nov14 + hour, verdict: 'failed', says: 'Went quiet.' });
    await deadlinesAfter(book, 100);

    const { days } = await closedAsked(book, { time_zone: pacific, until: '2026-11-14', days: 1 });

    expect(days?.counts).toEqual([{ day: '2026-11-14', judged: 101, passed: 0 }]);
  });
});

describe('the range of days of a goal judged thing by thing', () => {
  it('ends today in the time zone when no last day is asked, and keep as many days as asked', async () => {
    const book = assessmentBookOf();
    await fourDays(book);

    const today = await closedAsked(book, { time_zone: pacific, days: 2 });
    const tomorrow = await closedAsked(book, { time_zone: pacific, days: 2 }, nov16 + 25 * hour);

    expect(today.days?.counts.map(({ day }) => day)).toEqual(['2026-11-16', '2026-11-15']);
    expect(tomorrow.days?.counts.map(({ day }) => day)).toEqual(['2026-11-17', '2026-11-16']);
  });

  it('is seven days by default, with none before the first was judged', async () => {
    const book = assessmentBookOf();
    await fourDays(book);

    const { days } = await closedAsked(book, { time_zone: pacific, until: '2026-11-20' });

    expect(days?.counts.map(({ day }) => day)).toEqual([
      '2026-11-20',
      '2026-11-19',
      '2026-11-18',
      '2026-11-17',
      '2026-11-16',
      '2026-11-15',
      '2026-11-14',
    ]);
  });

  it('is empty when nothing was judged, and left out when no time zone is asked', async () => {
    const book = assessmentBookOf();
    await ended(book, 'c-1', 'goal_retired', nov13);

    const asked = await closedAsked(book, { time_zone: pacific });
    const notAsked = await closedAsked(book);

    expect(asked.days).toEqual({ time_zone: pacific, counts: [] });
    expect(notAsked).not.toHaveProperty('days');
  });
});

describe('the run of a goal since its last pass', () => {
  it('names the last pass, and when the misses since began and how many ended since, an ending with no result among them', async () => {
    const book = assessmentBookOf();
    const { lastPass } = await fourDays(book);

    const closed = await closedAsked(book);

    expect(closed.last_passed).toEqual({ id: lastPass, at: instantText(nov13 + 23 * hour) });
    expect(closed.misses_since).toEqual({ at: instantText(nov14 + hour), count: 3 });
  });

  it('counts every miss from the first when nothing ever passed', async () => {
    const book = assessmentBookOf();
    await judged(book, { per: 'c-1', at: nov13, verdict: 'failed' });
    await judged(book, { per: 'c-2', at: nov14, verdict: 'failed' });

    const closed = await closedAsked(book);

    expect(closed).not.toHaveProperty('last_passed');
    expect(closed.misses_since).toEqual({ at: instantText(nov13), count: 2 });
  });

  it('has no misses when the latest that ended passed, and nothing at all before anything ended', async () => {
    const book = assessmentBookOf();
    const nothing = await closedAsked(book);
    await judged(book, { per: 'c-1', at: nov13, verdict: 'failed' });
    const passed = await judged(book, { per: 'c-2', at: nov14, verdict: 'passed' });

    const closed = await closedAsked(book);

    expect(nothing).not.toHaveProperty('last_passed');
    expect(nothing).not.toHaveProperty('misses_since');
    expect(closed.last_passed).toEqual({ id: passed, at: instantText(nov14) });
    expect(closed).not.toHaveProperty('misses_since');
  });
});
