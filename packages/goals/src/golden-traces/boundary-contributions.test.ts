import { expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { traceBookOf, type TraceBook } from './trace-book.ts';
import { tracedGoalId } from './trace-book.ts';
import { wordsOf } from './trace-words.ts';

const day = (offset: number, hour = 0) => Date.UTC(2026, 10, 9 + offset, hour);

const checks: GoalRule = {
  id: 'checks-pass',
  per: 'check run',
  window: { after: 'started', for: 'PT3M', grace: 'PT1M' },
  success: { settles: 'on_crossing', target: { at_most: 0 } },
  milestones: [
    { id: 'started', label: 'Started', by: 'auto' },
    { id: 'judged', label: 'Judged', by: 'auto' },
  ],
  notify: { passed: 'quiet', failed: 'now', overdue: 'now' },
};

const checkRun = assessmentIdOf({ definition: tracedGoalId, per: 'run-1' });

const marking = { per_id: '/id', marks: 'started' } as const;

const measuring = { per_id: '/id', measures: '/failed', final: '/complete', as_of: '/as_of' } as const;

const finishedEarlier = (at: number, failed: number) => ({
  id: 'run-1',
  failed,
  complete: true,
  as_of: new Date(at - 61_000).toISOString(),
});

const seen = (book: TraceBook, at: number, failed: number, measuresFirst: boolean) =>
  book
    .run({
      at,
      entry: measuresFirst ? measuring : marking,
      also: [measuresFirst ? marking : measuring],
      output: finishedEarlier(at, failed),
    })
    .map((appended) => wordsOf(appended, { [checkRun]: 'run-1' }));

const orders = [
  { order: 'marks, then measures', measuresFirst: false },
  { order: 'measures, then marks', measuresFirst: true },
] as const;

it.each(orders)(
  'fails at once on the crossing another contribution of the run that opens an after window measured before its end: $order',
  ({ measuresFirst }) => {
    const book = traceBookOf(checks, day(-1));

    expect(seen(book, day(0, 9), 1, measuresFirst)).toContain('run-1 assessed failed crossing now');
  },
);

it.each(orders)(
  'passes at due on the final another contribution of the run that opens an after window measured before its end, while later runs repeat it: $order',
  ({ measuresFirst }) => {
    const book = traceBookOf(checks, day(-1));
    seen(book, day(0, 9), 0, measuresFirst);
    book.run({ at: day(0, 9) + 60_000, entry: measuring, output: finishedEarlier(day(0, 9), 0) });

    expect(book.ring(day(0, 9) + 240_000).map(({ fact }) => fact.type)).toEqual(['goal_assessed']);
    expect(book.state(checkRun)).toMatchObject({ verdict: 'passed', finalMeasurement: { value: 0, opening: true } });
    expect(book.state(checkRun).overdueSince).toBeUndefined();
  },
);

it('keeps as progress the measurement another contribution of a later run reports from before the window opened', () => {
  const book = traceBookOf(checks, day(-1));
  book.run({ at: day(0, 9), entry: marking, output: { id: 'run-1' } });
  book.run({ at: day(0, 9) + 60_000, entry: measuring, output: finishedEarlier(day(0, 9), 1) });

  expect(book.state(checkRun)).toMatchObject({ verdict: 'open', measurement: { value: 1 } });
  expect(book.state(checkRun).finalMeasurement).toBeUndefined();
});
