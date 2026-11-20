import { expect, it } from 'vitest';

import { noticeDueOf } from '../assessments/assessment-dues.ts';
import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { clockWorkAt } from '../goal-clock/goal-clock.ts';
import type { GoalRule, Target } from '../goal-rules/goal-rule.ts';
import { aDay } from '../goal-windows/goal-durations.ts';
import { traceBookOf, type TraceBook } from './trace-book.ts';
import { tracedGoalId } from './trace-book.ts';
import { wordsOf } from './trace-words.ts';

const day = (offset: number, hour = 0) => Date.UTC(2026, 10, 9 + offset, hour);

const daily = (target: Target, settles: 'on_crossing' | 'at_close' = 'on_crossing'): GoalRule => ({
  id: 'daily-check',
  window: { calendar: 'day' },
  success: { settles, target },
  notify: { passed: 'now', failed: 'now', overdue: 'now' },
});

const monday = assessmentIdOf({ definition: tracedGoalId, window_start: day(0) });

const named = { [monday]: 'Monday' };

interface Reading {
  readonly value: number;
  readonly final: boolean;
  readonly through?: number;
}

const measured = (book: TraceBook, at: number, { value, final, through }: Reading) =>
  book
    .run({
      at,
      entry: { measures: '/v', final: '/f', as_of: '/at' },
      output: { v: value, f: final, at: new Date(through ?? at).toISOString() },
    })
    .map((appended) => wordsOf(appended, named));

const rung = (book: TraceBook, at: number, playbookRetired = false) =>
  book.ring(at, { playbookRetired }).map((appended) => wordsOf(appended, named));

it('puts a final measurement taken exactly through midnight in the day it closes', () => {
  const book = traceBookOf(daily({ at_most: 0 }), day(-1));
  rung(book, day(0));

  expect(measured(book, day(1, 0) + 60_000, { value: 0, final: true, through: day(1) })).toEqual([
    'Monday observed 0 final',
  ]);
  expect(rung(book, day(1, 1))).toContain('Monday assessed passed final now');
});

it.each([
  ['at least 1, a final of exactly 1, passes', { at_least: 1 }, 1, 'Monday assessed passed final now'],
  ['at least 1, a final of 0.99, fails', { at_least: 1 }, 0.99, 'Monday assessed failed final now'],
  ['at most 0, a final of exactly 0, passes', { at_most: 0 }, 0, 'Monday assessed passed final now'],
  ['at most 0, a final of 0.01, fails', { at_most: 0 }, 0.01, 'Monday assessed failed final now'],
] as const)('judges at close: %s', (_, target, value, verdict) => {
  const book = traceBookOf(daily(target, 'at_close'), day(-1));
  rung(book, day(0));

  expect(measured(book, day(0, 9), { value, final: true })).toEqual([`Monday observed ${value} final`]);
  expect(rung(book, day(1, 1))).toContain(verdict);
});

it.each([
  ['at least 1 crosses at exactly 1', { at_least: 1 }, 1, ['Monday observed 1', 'Monday assessed passed crossing now']],
  ['at most 0 does not cross at exactly 0', { at_most: 0 }, 0, ['Monday observed 0']],
  ['at most 0 crosses above 0', { at_most: 0 }, 1, ['Monday observed 1', 'Monday assessed failed crossing now']],
] as const)('judges a crossing: %s', (_, target, value, expected) => {
  const book = traceBookOf(daily(target), day(-1));
  rung(book, day(0));

  expect(measured(book, day(0, 9), { value, final: false })).toEqual(expected);
});

it('lets a crossing in the window count after a final came earlier, and not after the close', () => {
  const book = traceBookOf(daily({ at_most: 0 }), day(-1));
  rung(book, day(0));
  measured(book, day(0, 9), { value: 0, final: true });

  expect(measured(book, day(1, 0) + 1, { value: 3, final: false, through: day(0, 23) })).toEqual(['Monday observed 3']);
  expect(rung(book, day(1, 1))).toContain('Monday assessed passed final now');
});

it('keeps the latest final by its as_of, so an older or equal final arriving later changes nothing', () => {
  const book = traceBookOf(daily({ at_most: 0 }, 'at_close'), day(-1));
  rung(book, day(0));
  measured(book, day(0, 9), { value: 0, final: true });

  expect(measured(book, day(0, 10), { value: 1, final: true, through: day(0, 8) })).toEqual([]);
  expect(measured(book, day(0, 11), { value: 1, final: true, through: day(0, 9) })).toEqual([]);
  expect(book.state(monday).finalMeasurement?.value).toBe(0);
});

it('settles an overdue window at once when its final arrives after the due', () => {
  const book = traceBookOf(daily({ at_most: 0 }), day(-1));
  rung(book, day(0));
  rung(book, day(1, 1));

  expect(measured(book, day(1, 5), { value: 0, final: true, through: day(0, 23) })).toEqual([
    'Monday observed 0 final',
    'Monday assessed passed final now',
  ]);
  expect(book.state(monday).verdictAt).toBe(day(1, 5));
});

it('ends a window that fell due while the playbook was retired, owing no notice', () => {
  const book = traceBookOf(daily({ at_most: 0 }), day(-1));
  rung(book, day(0));

  expect(rung(book, day(0, 12), true)).toEqual([]);
  expect(rung(book, day(1, 1), true)).toEqual(['Monday assessment_ended playbook_retired']);
  expect(noticeDueOf(book.state(monday))).toBeUndefined();
});

it('opens nothing while the playbook is retired and moves its clock to the next UTC midnight, or to the first at or after its boundary if later', () => {
  const retiredAt = (now: number) =>
    clockWorkAt({
      definition: tracedGoalId,
      goal: daily({ at_most: 0 }),
      goalVersion: 1,
      now,
      firstSavedAt: day(-1),
      reporting: true,
      playbookRetired: true,
    });

  expect(retiredAt(day(0, 6))).toEqual({ nextAt: day(1) });
  expect(
    clockWorkAt({
      definition: tracedGoalId,
      goal: { ...daily({ at_most: 0 }), window: { calendar: 'month' } },
      goalVersion: 1,
      now: day(0, 6),
      firstSavedAt: 0,
      reporting: true,
      playbookRetired: true,
    }),
  ).toEqual({
    nextAt: Date.UTC(2026, 11, 1),
  });
  expect(retiredAt(day(1)).nextAt).toBe(day(2));
});

it('resumes opening windows when the playbook is restored', () => {
  const book = traceBookOf(daily({ at_most: 0 }), day(-1));

  expect(rung(book, day(0), true)).toEqual([]);
  expect(rung(book, day(0, 3))).toEqual([`Monday assessment_opened due ${new Date(day(1, 1)).toISOString()}`]);
});

it('keeps the target an assessment opened with when the target is edited while it is open', () => {
  const book = traceBookOf(daily({ at_least: 5 }), day(-1));
  rung(book, day(0));
  book.change(daily({ at_least: 1 }));

  expect(measured(book, day(0, 9), { value: 2, final: false })).toEqual(['Monday observed 2']);
  rung(book, day(1));
  const tuesday = assessmentIdOf({ definition: tracedGoalId, window_start: day(1) });
  expect([book.state(monday).pinned?.target, book.state(tuesday).pinned?.target]).toEqual([
    { at_least: 5 },
    { at_least: 1 },
  ]);
  expect(book.state(tuesday).pinned?.goalVersion).toBe(2);
});

it('keeps the window rule an assessment opened with when the goal under that id changes its unit', () => {
  const book = traceBookOf(daily({ at_most: 0 }), day(-1));
  rung(book, day(0));
  book.change({ ...daily({ at_most: 0 }), window: { calendar: 'week' } });

  expect(book.state(monday).pinned?.window).toEqual({ calendar: 'day' });
  expect(rung(book, day(1, 1))).toEqual(['Monday overdue now']);
});

it('follows the Los Angeles day of 23 hours when the clocks go forward', () => {
  const book = traceBookOf(
    { ...daily({ at_most: 0 }), window: { calendar: 'day', time_zone: 'America/Los_Angeles' } },
    0,
  );

  expect(book.ring(Date.parse('2026-03-08T08:00:00Z')).map(({ fact }) => fact.data)).toEqual([
    expect.objectContaining({
      window: {
        opens: '2026-03-08T08:00:00.000Z',
        closes: '2026-03-09T07:00:00.000Z',
        due: '2026-03-09T08:00:00.000Z',
      },
    }),
  ]);
});

const shipped = (success: GoalRule['success']): GoalRule => ({
  id: 'defects',
  per: 'release',
  window: { after: 'live', for: 'P1D', grace: 'PT1H' },
  success,
  milestones: [
    { id: 'built', label: 'Built', by: 'auto' },
    { id: 'live', label: 'Released', by: 'auto' },
    { id: 'reviewed', label: 'Reviewed', by: 'person' },
  ],
  notify: { passed: 'now', failed: 'now', overdue: 'now' },
});

const release = assessmentIdOf({ definition: tracedGoalId, per: 'R-1' });

const releaseNamed = { [release]: 'R-1' };

const markedAndMeasured = (book: TraceBook, at: number, reading: Reading, marks = 'live') =>
  book
    .run({
      at,
      entry: { per_id: '/id', marks, measures: '/v', final: '/f', as_of: '/at' },
      output: { id: 'R-1', v: reading.value, f: reading.final, at: new Date(reading.through ?? at).toISOString() },
    })
    .map((appended) => wordsOf(appended, releaseNamed));

const dueAfter = (at: number) => `due ${new Date(at + aDay + 3_600_000).toISOString()}`;

const atMost = { settles: 'on_crossing', target: { at_most: 0 } } as const;

const atLeast = { settles: 'on_crossing', target: { at_least: 1 } } as const;

it.each([
  { name: 'at most 0 fails at once on 1', success: atMost, verdict: 'failed', early: 0 },
  { name: 'at most 0 fails at once on 1', success: atMost, verdict: 'failed', early: 150 },
  { name: 'at least 1 passes at once on exactly 1', success: atLeast, verdict: 'passed', early: 0 },
  { name: 'at least 1 passes at once on exactly 1', success: atLeast, verdict: 'passed', early: 150 },
] as const)(
  'counts a crossing measured by the run that opens an after window: $name, as of $early ms before its end',
  ({ success, verdict, early }) => {
    const book = traceBookOf(shipped(success), day(-1));

    expect(markedAndMeasured(book, day(0, 9), { value: 1, final: false, through: day(0, 9) - early })).toEqual([
      'R-1 assessment_opened',
      `R-1 observed marks live 1 ${dueAfter(day(0, 9))}`,
      `R-1 assessed ${verdict} crossing now`,
    ]);
  },
);

it.each([
  { value: 0, verdict: 'passed', early: 0 },
  { value: 0, verdict: 'passed', early: 150 },
  { value: 1, verdict: 'failed', early: 0 },
  { value: 1, verdict: 'failed', early: 150 },
] as const)(
  'judges at due the final measured by the run that opens an after window: at most 0, a final of $value is $verdict, as of $early ms before its end',
  ({ value, verdict, early }) => {
    const book = traceBookOf(shipped({ settles: 'at_close', target: { at_most: 0 } }), day(-1));

    expect(markedAndMeasured(book, day(0, 9), { value, final: true, through: day(0, 9) - early })).toEqual([
      'R-1 assessment_opened',
      `R-1 observed marks live ${value} final ${dueAfter(day(0, 9))}`,
    ]);
    expect(book.state(release).finalMeasurement?.value).toBe(value);
    expect(rung(book, day(1, 10))).toEqual([`another assessed ${verdict} final now`]);
    expect(book.state(release).overdueSince).toBeUndefined();
  },
);

it('keeps a measurement of a run before the one that opens an after window as progress that settles nothing', () => {
  const book = traceBookOf(shipped({ settles: 'on_crossing', target: { at_most: 0 } }), day(-1));
  markedAndMeasured(book, day(0, 9) - 150, { value: 1, final: true }, 'built');

  expect(
    book
      .run({ at: day(0, 9), entry: { per_id: '/id', marks: 'live' }, output: { id: 'R-1' } })
      .map((appended) => wordsOf(appended, releaseNamed)),
  ).toEqual([`R-1 observed marks live ${dueAfter(day(0, 9))}`]);
  expect([book.state(release).measurement?.value, book.state(release).finalMeasurement]).toEqual([1, undefined]);
  expect(rung(book, day(1, 10))).toEqual(['another overdue now']);
});

it('keeps a measurement of the run that marks the after milestone again as one that settles nothing', () => {
  const book = traceBookOf(shipped({ settles: 'at_close', target: { at_most: 0 } }), day(-1));
  markedAndMeasured(book, day(0, 9), { value: 0, final: false });

  expect(markedAndMeasured(book, day(0, 10), { value: 1, final: true, through: day(0, 9) - 150 })).toEqual([]);
  expect(book.state(release).finalMeasurement).toBeUndefined();
});

it('leaves a measurement through midnight out of the day that opens then, for the day that closes then', () => {
  const book = traceBookOf(daily({ at_most: 0 }), day(-1));
  rung(book, day(0));
  rung(book, day(1));
  const tuesday = assessmentIdOf({ definition: tracedGoalId, window_start: day(1) });

  expect(measured(book, day(1, 0) + 60_000, { value: 1, final: true, through: day(1) })).toEqual([
    'Monday observed 1 final',
  ]);
  expect(book.state(tuesday).measurement).toBeUndefined();
  expect(rung(book, day(1, 1))).toEqual(['Monday assessed failed final now']);
});
