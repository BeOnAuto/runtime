import { describe, expect, it, onTestFinished } from 'vitest';

import {
  assessing,
  contributingWorkflow,
  evaluatedOnceARun,
  ranOnItsSchedule,
  savedWorkflow,
} from '../testing/goals/assessed-runs.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { servingReasoning } from '../testing/servers/reasoning-server.ts';
import { goalsText, plainGoalId } from '../testing/settings/goals-kept.ts';
import { until } from '../testing/waiting/until.ts';

const manyText = [
  '- id: many-things',
  '  statement: Every thing we track brings in at least one order.',
  '  per: thing',
  '  success:',
  '    label: Orders of the thing',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Ordered',
  '    failed: Not ordered',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

const counting = '$data.n >= 0';

const things = (from: number, count: number) =>
  JSON.stringify(Array.from({ length: count }, (_, index) => ({ id: `thing-${String(from + index)}`, n: 1 })));

const entryOf = (list: string, when = counting) => [
  '  - goal: many-things',
  '    purpose: Counts the orders of each thing.',
  `    each: /${list}`,
  '    per_id: /id',
  '    measures: /n',
  `    when: \${ ${when} }`,
];

const fanningOut = [
  'contributes:',
  ...entryOf('first'),
  ...entryOf('second'),
  ...entryOf('third', '$data.n > 0'),
  'schedule:',
  '  every: PT1M',
  'do:',
  `  - fan: { set: { first: ${things(0, 100)}, second: ${things(100, 100)}, third: ${things(200, 50)} } }`,
];

const tallying = [
  'contributes:',
  `  - goal: ${plainGoalId}`,
  '    purpose: Counts the orders of the week.',
  '    measures: /orders',
  'schedule:',
  '  every: PT1M',
  'do:',
  '  - count: { set: { orders: 30 } }',
];

const tallyOfAnOlderPlaybook = contributingWorkflow('tally', [
  'schedule:',
  '  every: PT1M',
  'do:',
  '  - count: { set: { orders: 3 } }',
]);

function observedWhileAsked(rows: Readonly<Record<string, unknown>>, asked: readonly string[]): boolean {
  return Object.keys(rows).length > 0 && asked.includes('rows goal_clocks acme/beta');
}

function askedOfBeta(asked: readonly string[]): readonly string[] {
  return asked.filter((one) => one.includes('beta') && one !== 'rows goal_assessments acme/beta');
}

function aLedger() {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

describe('the cost of the assessor on a Node server', () => {
  it('evaluates a run that touches many assessments once, across the passes its deliveries take', async () => {
    const assessed = await assessing({ ledger: aLedger(), goals: `${goalsText}${manyText}`, watching: counting });
    onTestFinished(assessed.server.stop);
    expect(await savedWorkflow(assessed.server, 'fan-out', fanningOut)).toBe(201);

    await ranOnItsSchedule(assessed, 'fan-out');
    const rows = await until(
      () => assessed.rowsOf('goal_assessments'),
      (held) => Object.keys(held).length === 250,
    );
    const { runs, tests } = await evaluatedOnceARun(assessed, 'fan-out', 200);
    const passes = assessed.asked.filter((asked) => asked === 'rows goal_clocks acme/alpha').length;

    expect(Object.values(rows).every((row) => row['verdict'] === 'passed')).toBe(true);
    expect(tests).toBe(200 * runs);
    expect(runs).toBeGreaterThan(0);
    expect(passes).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('reads nothing of an older playbook with no goals but whether it has a clock row, and observes none of its runs (trace D)', async () => {
    const ledger = aLedger();
    const before = await servingReasoning([], {}, undefined, { ledger });
    await before.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'beta', name: 'Beta' } });
    await before.call('POST', '/v1/orgs/acme/playbooks/beta/definitions/workflow', {
      body: { name: 'tally', source: tallyOfAnOlderPlaybook },
    });
    await before.stop();
    const assessed = await assessing({ ledger, goals: goalsText });
    onTestFinished(assessed.server.stop);
    expect(await savedWorkflow(assessed.server, 'tally', tallying)).toBe(201);

    await until(
      () => {
        assessed.ranAMinuteOn();
        return assessed.rowsOf('goal_assessments');
      },
      (alpha) => observedWhileAsked(alpha, assessed.asked),
    );
    const beta = await assessed.rowsOf('goal_assessments', 'beta');
    const ofBeta = askedOfBeta(assessed.asked);

    expect(Object.keys(beta)).toEqual([]);
    expect(new Set(ofBeta.filter((asked) => asked.startsWith('rows ')))).toEqual(
      new Set(['rows goal_clocks acme/beta']),
    );
    expect(ofBeta.filter((asked) => /goals\/playbook|assessments\/|goal-refusals\//u.test(asked))).toEqual([]);
  });
});
