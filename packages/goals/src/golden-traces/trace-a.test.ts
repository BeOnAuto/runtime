import { expect, it } from 'vitest';

import { judgingDueOf } from '../assessments/assessment-dues.ts';
import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { traceBookOf, type TraceBook } from './trace-book.ts';
import { tracedGoalId } from './trace-book.ts';
import type { Appended } from './trace-ledger.ts';
import { rowsAndCoreOf } from './trace-rows.ts';
import { wordsOf } from './trace-words.ts';

const day = (offset: number, hour = 0) => Date.UTC(2026, 10, 9 + offset, hour);

const controls: GoalRule = {
  id: 'controls-hold',
  window: { calendar: 'day', grace: 'PT1H' },
  success: { settles: 'on_crossing', target: { at_most: 0 } },
  notify: { passed: 'quiet', failed: 'now', overdue: 'now' },
};

const windowOf = (offset: number) => assessmentIdOf({ definition: tracedGoalId, window_start: day(offset) });

const names: Readonly<Record<string, string>> = {
  [windowOf(0)]: 'Monday',
  [windowOf(1)]: 'Tuesday',
  [windowOf(2)]: 'Wednesday',
  [windowOf(3)]: 'Thursday',
};

const book = traceBookOf(controls, day(-1, 12));

const check = (at: number, failed: number, allReported: boolean) => () =>
  book.run({
    at,
    entry: { measures: '/failed', final: '/all_reported' },
    output: { failed, all_reported: allReported },
  });

const ring =
  (at: number, reporting = true) =>
  () =>
    book.ring(at, { reporting });

const iso = (at: number) => new Date(at).toISOString();

const trace: readonly (readonly [string, () => readonly Appended[], readonly string[]])[] = [
  ['Mon 00:00 the clock opens Monday, due Tue 01:00', ring(day(0)), [`Monday assessment_opened due ${iso(day(1, 1))}`]],
  ['Mon 09:00 the check: failed 0, all reported', check(day(0, 9), 0, true), ['Monday observed 0 final']],
  ['Tue 00:00 the clock opens Tuesday', ring(day(1)), [`Tuesday assessment_opened due ${iso(day(2, 1))}`]],
  ['Tue 01:00 Monday is due: its final 0 is within target', ring(day(1, 1)), ['Monday assessed passed final quiet']],
  ['Tue 09:00 the check: 0, one control silent', check(day(1, 9), 0, false), ['Tuesday observed 0']],
  ['Wed 00:00 the clock opens Wednesday', ring(day(2)), [`Wednesday assessment_opened due ${iso(day(3, 1))}`]],
  ['Wed 01:00 Tuesday is due with no final', ring(day(2, 1)), ['Tuesday overdue now']],
  ['Wed 09:00 the check: 0, final', check(day(2, 9), 0, true), ['Wednesday observed 0 final']],
  [
    'Wed 14:00 an alert reports failed 1',
    check(day(2, 14), 1, false),
    ['Wednesday observed 1', 'Wednesday assessed failed crossing now'],
  ],
  ['Wed 16:00 the check reports 0 again', check(day(2, 16), 0, true), []],
  ['Thu 00:00 the clock opens Thursday', ring(day(3)), [`Thursday assessment_opened due ${iso(day(4, 1))}`]],
  [
    'Thu 01:00 Tuesday is still overdue a window after its due',
    ring(day(3, 1)),
    ['Tuesday assessed failed deadline now'],
  ],
  ['Fri 00:00 nothing reports the measure, so Friday does not open', ring(day(4), false), []],
  ['Fri 01:00 Thursday is due with no final', ring(day(4, 1), false), ['Thursday overdue now']],
  [
    'Sat 01:00 Thursday is still overdue a window after its due',
    ring(day(5, 1), false),
    ['Thursday assessed failed deadline now'],
  ],
];

it.each(trace)('%s', (_, step, expected) => {
  expect(step().map((appended) => wordsOf(appended, names))).toEqual(expected);
});

it('ends with Monday passed, Tuesday and Thursday missed by their deadlines, and Wednesday failed', () => {
  expect(
    [0, 1, 2, 3].map((offset) => {
      const state = book.state(windowOf(offset));
      return [state.verdict, state.verdictBy, judgingDueOf(state)];
    }),
  ).toEqual([
    ['passed', 'final', undefined],
    ['failed', 'deadline', undefined],
    ['failed', 'crossing', undefined],
    ['failed', 'deadline', undefined],
  ]);
  expect(book.assessments()).toHaveLength(4);
});

it('keeps an unknown assessment unnamed in the words of a trace', () => {
  const other: TraceBook = traceBookOf({ ...controls, id: 'another-goal' }, day(-1), 'another-goal-of-the-playbook');

  expect(other.ring(day(0)).map((appended) => wordsOf(appended, names))).toEqual([
    `another assessment_opened due ${iso(day(1, 1))}`,
  ]);
});

it('folds every assessment of the trace into the row of its table as the core holds it, its dues among them', () => {
  const pairs = rowsAndCoreOf(book);

  expect(pairs.map(([row]) => row)).toEqual(pairs.map(([, core]) => core));
  expect(pairs.length).toBeGreaterThan(0);
});
