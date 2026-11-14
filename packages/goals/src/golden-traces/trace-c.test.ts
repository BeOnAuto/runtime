import { expect, it } from 'vitest';

import { judgingDueOf } from '../assessments/assessment-dues.ts';
import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { traceBookOf } from './trace-book.ts';
import type { Appended } from './trace-ledger.ts';
import { rowsAndCoreOf } from './trace-rows.ts';
import { wordsOf } from './trace-words.ts';

const at = (text: string) => Date.parse(text);

const costPerLead: GoalRule = {
  id: 'cost-per-lead',
  window: { calendar: 'week', time_zone: 'America/Los_Angeles', grace: 'PT8H' },
  success: { settles: 'at_close', target: { at_most: 50 } },
  notify: { passed: 'summary', failed: 'now', overdue: 'now' },
};

const weekOf = (opens: string) => assessmentIdOf({ goal: 'cost-per-lead', window_start: at(opens) });

const names = {
  [weekOf('2026-11-02T08:00:00Z')]: 'first week',
  [weekOf('2026-11-09T08:00:00Z')]: 'second week',
};

const book = traceBookOf(costPerLead, at('2026-11-01T12:00:00Z'));

const report =
  (when: string, cost: number, final: boolean, through = when) =>
  () =>
    book.run({
      at: at(when),
      entry: { measures: '/cost', final: '/final', as_of: '/through' },
      output: { cost, final, through },
    });

const trace: readonly (readonly [string, () => readonly Appended[], readonly string[]])[] = [
  [
    'Monday 00:00 local the clock opens the week, due Monday 08:00 local a week on',
    () => book.ring(at('2026-11-02T08:00:00Z')),
    ['first week assessment_opened due 2026-11-09T16:00:00.000Z'],
  ],
  [
    'a daily measurement above the target is progress',
    report('2026-11-04T17:00:00Z', 80, false),
    ['first week observed 80'],
  ],
  [
    'a lower one later in the week is progress too',
    report('2026-11-06T17:00:00Z', 45, false),
    ['first week observed 45'],
  ],
  [
    'Monday 07:00 local last week is reported final, as of Monday 00:00 local',
    report('2026-11-09T15:00:00Z', 42, true, '2026-11-09T00:00:00-08:00'),
    ['first week observed 42 final'],
  ],
  [
    'Monday 08:00 local the week is judged, and the next week opens',
    () => book.ring(at('2026-11-09T16:00:00Z')),
    ['second week assessment_opened due 2026-11-16T16:00:00.000Z', 'first week assessed passed final summary'],
  ],
];

it.each(trace)('%s', (_, step, expected) => {
  expect(step().map((appended) => wordsOf(appended, names))).toEqual(expected);
});

const invoices: GoalRule = {
  id: 'invoices-paid',
  per: 'invoice',
  success: { settles: 'on_crossing', target: { at_least: 1 } },
  milestones: [
    { id: 'sent', label: 'Sent', by: 'auto' },
    { id: 'chased', label: 'Chased', by: 'auto' },
    { id: 'paid', label: 'Paid', by: 'auto' },
  ],
  notify: { passed: 'summary', failed: 'now' },
};

it('makes each invoice its own assessment', () => {
  const ledger = traceBookOf(invoices, 0);
  ledger.run({
    at: at('2026-11-09T09:00:00Z'),
    entry: { each: '/invoices', per_id: '/number', marks: 'sent' },
    output: { invoices: [{ number: 'INV-1' }, { number: 'INV-2' }, { number: 'INV-3' }] },
  });

  expect(ledger.assessments()).toEqual(
    ['INV-1', 'INV-2', 'INV-3'].map((per) => assessmentIdOf({ goal: 'invoices-paid', per })),
  );
});

const oneOff: GoalRule = {
  id: 'first-customer',
  success: { settles: 'on_crossing', target: { at_least: 1 } },
  notify: { passed: 'now', failed: 'now' },
};

it('passes a goal with no window on its crossing, and otherwise leaves it open with nothing due', () => {
  const ledger = traceBookOf(oneOff, 0);
  const whole = assessmentIdOf({ goal: 'first-customer' });
  const measured = (when: string, customers: number) =>
    ledger
      .run({ at: at(when), entry: { measures: '/customers', final: true }, output: { customers } })
      .map((appended) => wordsOf(appended, { [whole]: 'one-off' }));

  expect(measured('2026-11-09T09:00:00Z', 0)).toEqual(['one-off assessment_opened', 'one-off observed 0 final']);
  expect(ledger.ring(at('2027-11-09T09:00:00Z'))).toEqual([]);
  expect(judgingDueOf(ledger.state(whole))).toBeUndefined();
  expect(measured('2027-11-10T09:00:00Z', 1)).toEqual([
    'one-off observed 1 final',
    'one-off assessed passed crossing now',
  ]);
});

it('folds every assessment of the trace into the row of its table as the core holds it, its dues among them', () => {
  const pairs = rowsAndCoreOf(book);

  expect(pairs.map(([row]) => row)).toEqual(pairs.map(([, core]) => core));
  expect(pairs.length).toBeGreaterThan(0);
});
