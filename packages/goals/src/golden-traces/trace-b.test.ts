import { expect, it } from 'vitest';

import { judgingDueOf, nextMilestoneOf } from '../assessments/assessment-dues.ts';
import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { traceBookOf } from './trace-book.ts';
import { tracedGoalId } from './trace-book.ts';
import type { Appended } from './trace-ledger.ts';
import { rowsAndCoreOf } from './trace-rows.ts';
import { wordsOf } from './trace-words.ts';

const day = (number: number, hour = 10) => Date.UTC(2026, 10, 1 + number, hour);

const iso = (at: number) => new Date(at).toISOString();

const experiments: GoalRule = {
  id: 'paying-customers',
  per: 'experiment',
  window: { after: 'live', for: 'P7D', grace: 'P1D' },
  success: { settles: 'on_crossing', target: { at_least: 1 } },
  milestones: [
    { id: 'chosen', label: 'Idea chosen', by: 'person' },
    { id: 'prepared', label: 'Package prepared', by: 'auto' },
    { id: 'live', label: 'Taken live', by: 'person' },
    { id: 'measured', label: 'Measured', by: 'auto' },
    { id: 'concluded', label: 'Lesson kept', by: 'person' },
  ],
  notify: { passed: 'now', failed: 'now', overdue: 'now' },
};

const thing = (per: string) => assessmentIdOf({ definition: tracedGoalId, per });

const names = Object.fromEntries(['MAR-41', 'MAR-42', 'MAR-43', 'MAR-52', 'MAR-62'].map((per) => [thing(per), per]));

const book = traceBookOf(experiments, day(0));

const mark = (issue: string, milestone: string, at: number) => () =>
  book.run({ at, entry: { per_id: '/issue', marks: milestone }, output: { issue } });

interface Measuring {
  readonly customers: number;
  readonly final?: boolean;
  readonly through?: number;
  readonly summary?: string;
}

const measure = (issue: string, at: number, measuring: Measuring) => () =>
  book.run({
    at,
    entry: { per_id: '/issue', measures: '/customers', final: '/closed', as_of: '/through', says: '/summary' },
    output: {
      issue,
      customers: measuring.customers,
      closed: measuring.final ?? false,
      through: iso(measuring.through ?? at),
      ...(measuring.summary === undefined ? {} : { summary: measuring.summary }),
    },
  });

const ring = (at: number) => () => book.ring(at);

const marked = (issue: string, milestone: string) => `${issue} observed marks ${milestone}`;

const trace: readonly (readonly [string, () => readonly Appended[], readonly string[]])[] = [
  [
    'MAR-41 chosen: opened, with no window yet',
    mark('MAR-41', 'chosen', day(1)),
    ['MAR-41 assessment_opened', marked('MAR-41', 'chosen')],
  ],
  ['MAR-41 prepared', mark('MAR-41', 'prepared', day(1, 11)), [marked('MAR-41', 'prepared')]],
  ['MAR-41 prepared a second time changes nothing', mark('MAR-41', 'prepared', day(1, 12)), []],
  [
    'MAR-42, 43, 52 and 62 are chosen',
    () => ['MAR-42', 'MAR-43', 'MAR-52', 'MAR-62'].flatMap((issue) => mark(issue, 'chosen', day(1))()),
    [
      'MAR-42 assessment_opened',
      marked('MAR-42', 'chosen'),
      'MAR-43 assessment_opened',
      marked('MAR-43', 'chosen'),
      'MAR-52 assessment_opened',
      marked('MAR-52', 'chosen'),
      'MAR-62 assessment_opened',
      marked('MAR-62', 'chosen'),
    ],
  ],
  ['MAR-43 is prepared and never taken live', mark('MAR-43', 'prepared', day(1)), [marked('MAR-43', 'prepared')]],
  [
    'MAR-41 goes live on day 2: due day 10',
    mark('MAR-41', 'live', day(2)),
    [`${marked('MAR-41', 'live')} due ${iso(day(10))}`],
  ],
  [
    'MAR-42, 52 and 62 go live on day 3: due day 11',
    () => ['MAR-42', 'MAR-52', 'MAR-62'].flatMap((issue) => mark(issue, 'live', day(3))()),
    [
      `${marked('MAR-42', 'live')} due ${iso(day(11))}`,
      `${marked('MAR-52', 'live')} due ${iso(day(11))}`,
      `${marked('MAR-62', 'live')} due ${iso(day(11))}`,
    ],
  ],
  ['MAR-42 is polled hourly: 0, not final', measure('MAR-42', day(4), { customers: 0 }), ['MAR-42 observed 0']],
  [
    'MAR-41 day 5: a measurement of 1 passes it by crossing',
    measure('MAR-41', day(5), { customers: 1, summary: 'A $2 trial charge on Sunday is traced to MAR-41' }),
    ['MAR-41 observed 1', 'MAR-41 assessed passed crossing now'],
  ],
  ['MAR-99 is measured, though nobody marked it', measure('MAR-99', day(5), { customers: 3 }), []],
  ['MAR-42 is polled after its close, with the same number', measure('MAR-42', day(10, 12), { customers: 0 }), []],
  [
    'MAR-42 at the close: 0, final, as of the close, older than the standing poll',
    measure('MAR-42', day(10, 13), { customers: 0, final: true, through: day(10) }),
    ['MAR-42 observed 0 final'],
  ],
  [
    'MAR-42 is polled on after its final, with the same 0, not final',
    () => [day(10, 14), day(10, 15)].flatMap((at) => measure('MAR-42', at, { customers: 0 })()),
    [],
  ],
  [
    'day 11: MAR-42 fails by its final; MAR-52 and 62 go overdue',
    ring(day(11)),
    ['MAR-42 assessed failed final now', 'MAR-52 overdue now', 'MAR-62 overdue now'],
  ],
  [
    'MAR-41 day 11: the lesson is still recorded after the verdict',
    mark('MAR-41', 'concluded', day(11, 12)),
    [marked('MAR-41', 'concluded')],
  ],
  [
    'MAR-62 day 15: a later customer, not final, settles nothing',
    measure('MAR-62', day(15), { customers: 1 }),
    ['MAR-62 observed 1'],
  ],
  [
    'day 18: MAR-52 and 62 fail by their deadlines',
    ring(day(18)),
    ['MAR-52 assessed failed deadline now', 'MAR-62 assessed failed deadline now'],
  ],
];

it.each(trace)('%s', (_, step, expected) => {
  expect(step().map((appended) => wordsOf(appended, names))).toEqual(expected);
});

it('keeps MAR-42 standing on its latest changed number and decides it on the latest final', () => {
  const state = book.state(thing('MAR-42'));

  expect([state.measurement?.as_of, state.finalMeasurement?.as_of, state.verdictAt]).toEqual([
    day(10),
    day(10),
    day(11),
  ]);
});

it('keeps the evidence of MAR-41 with its measurement', () => {
  expect(book.state(thing('MAR-41')).measurement?.says).toBe('A $2 trial charge on Sunday is traced to MAR-41');
});

it('leaves MAR-43 open with no window, nothing due, and the person next', () => {
  const state = book.state(thing('MAR-43'));

  expect([state.verdict, state.window, judgingDueOf(state), nextMilestoneOf(state)]).toEqual([
    'open',
    undefined,
    undefined,
    'live',
  ]);
  expect(experiments.milestones?.find(({ id }) => id === nextMilestoneOf(state))?.by).toBe('person');
});

it('opens nothing for MAR-99', () => {
  expect(book.assessments()).not.toContain(thing('MAR-99'));
});

it('folds every assessment of the trace into the row of its table as the core holds it, its dues among them', () => {
  const pairs = rowsAndCoreOf(book);

  expect(pairs.map(([row]) => row)).toEqual(pairs.map(([, core]) => core));
  expect(pairs.length).toBeGreaterThan(0);
});
