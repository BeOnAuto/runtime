import { assessmentIdOf } from '@on.auto/goals';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  assessing,
  type Assessing,
  contributingWorkflow,
  evaluatedOnceARun,
  minuteByMinute,
  ranOnItsSchedule,
  savedWorkflow,
} from '../testing/goals/assessed-runs.ts';
import { goalOf, goalRowsOf } from '../testing/goals/goal-identities.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { goalsText, plainGoalId } from '../testing/settings/goals-kept.ts';
import { whenHeld } from '../testing/waiting/until.ts';

const controlsText = [
  '- id: controls-hold',
  '  statement: Every control passes its daily check.',
  '  window: { calendar: day, grace: PT1H }',
  '  success:',
  '    label: Failing controls',
  '    settles: on_crossing',
  '    target: { at_most: 0 }',
  '    passed: All controls held',
  '    failed: A control failed',
  '  notify: { passed: quiet, failed: now, overdue: now, through: tell-owner }',
  '',
].join('\n');

const plainGoalsOnly = goalsText.slice(goalsText.indexOf('- id: steady-orders'));

const everyMinute = ['schedule:', '  every: PT1M'];

const marksLive = (each: string) => [
  'contributes:',
  '  - goal: paying-customers',
  '    purpose: Takes each experiment live.',
  `    each: ${each}`,
  '    per_id: /issue',
  '    marks: live',
];

const liveOf = (issue: string) => [`  - live: { set: { experiments: [{ issue: ${issue} }] } }`];

const measuring = [
  'contributes:',
  '  - goal: paying-customers',
  '    purpose: Measures what each experiment brought in.',
  '    each: /results',
  '    per_id: /issue',
  '    measures: /customers',
  ...everyMinute,
  'do:',
  '  - count: { set: { results: [{ issue: MAR-41, customers: 1 }, { issue: MAR-99, customers: 1 }] } }',
];

const checking = (failed: number) => [
  'contributes:',
  '  - goal: controls-hold',
  '    purpose: Checks every control each day.',
  '    measures: /failed',
  '    final: /all_reported',
  ...everyMinute,
  'do:',
  `  - check: { set: { failed: ${String(failed)}, all_reported: true } }`,
];

const RunsSchema = Schema.Struct({ runs: Schema.Array(Schema.Struct({ status: Schema.String })) });

async function served(goals: string): Promise<Assessing> {
  const ledger = temporaryLedger();
  const assessed = await assessing({ ledger, goals });
  onTestFinished(async () => {
    await assessed.server.stop();
    ledger.remove();
  });
  return assessed;
}

async function succeeded(assessed: Assessing, name: string): Promise<void> {
  await whenHeld(
    async () =>
      Schema.decodeUnknownSync(RunsSchema)(
        (await assessed.server.call('GET', `${alpha}/runs?type=workflow&name=${name}`)).body,
      ).runs,
    (runs) => runs.length > 0 && runs.every(({ status }) => status === 'succeeded'),
  );
}

function rowsHolding(assessed: Assessing, holds: (rows: Readonly<Record<string, unknown>>) => boolean) {
  return minuteByMinute(assessed, () => assessed.rowsOf('goal_assessments'), holds);
}

async function experimentsOf(assessed: Assessing): Promise<readonly [string, string]> {
  const definition = await goalOf(assessed, 'paying-customers');
  return [assessmentIdOf({ definition, per: 'MAR-41' }), assessmentIdOf({ definition, per: 'MAR-60' })];
}
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
  `  - fan: { set: { first: ${things(0, 4)}, second: ${things(4, 4)}, third: ${things(8, 2)} } }`,
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

describe('trace B on a Node server, as far as the assessor reaches', () => {
  it('opens an experiment its schedule takes live, passes it on the crossing, counts what a person began and nothing begun as a test', async () => {
    const assessed = await served(goalsText);
    const { server } = assessed;
    const [mar41, mar60] = await experimentsOf(assessed);
    expect(
      await savedWorkflow(server, 'go-live', [
        ...marksLive('/experiments'),
        ...everyMinute,
        'do:',
        ...liveOf('MAR-41'),
      ]),
    ).toBe(201);
    await rowsHolding(assessed, (rows) => mar41 in rows);
    expect(await savedWorkflow(server, 'hand-live', [...marksLive('/experiments'), 'do:', ...liveOf('MAR-50')])).toBe(
      201,
    );
    const parent = ['  - nest: { call: run_definition, with: { type: workflow, name: hand-live, input: {} } }'];
    expect(await savedWorkflow(server, 'parent', [...marksLive('/none'), 'do:', ...parent])).toBe(201);
    const onPing = ['schedule:', '  on: { one: { with: { type: com.example.ping } } }'];
    expect(
      await savedWorkflow(server, 'on-ping', [...marksLive('/experiments'), ...onPing, 'do:', ...liveOf('MAR-60')]),
    ).toBe(201);

    await server.call('POST', `${alpha}/definitions/workflow/hand-live/run`, { body: { input: {}, test: true } });
    await server.call('POST', `${alpha}/definitions/workflow/parent/run`, { body: { input: {}, test: true } });
    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: 'https://example.com/tests', type: 'com.example.ping', data: {} } },
    });
    await Promise.all(['hand-live', 'parent', 'on-ping'].map((name) => succeeded(assessed, name)));
    expect(await savedWorkflow(server, 'measure', measuring)).toBe(201);
    const rows = await rowsHolding(assessed, (held) => JSON.stringify(held[mar41]).includes('"verdict":"passed"'));

    expect(Object.keys(rows).toSorted()).toEqual([mar41, mar60].toSorted());
    expect(rows[mar41]).toMatchObject({ per_id: 'MAR-41', verdict: 'passed', outcome: 'passed', goal_version: 1 });
    expect(typeof rows[mar41]?.['window_opens']).toBe('number');
    const leftOut = await server.call('PUT', alpha, { body: { goals: plainGoalsOnly } });
    expect(leftOut.status).toBe(422);
    expect(JSON.stringify(leftOut.body)).toContain('The goal paying-customers has been judged and cannot be left out');
  });
});

describe('trace A on a Node server, as far as the assessor reaches', () => {
  it('opens the day its check first reports, and fails it on the crossing of a later check', async () => {
    const assessed = await served(`${goalsText}${controlsText}`);
    expect(await savedWorkflow(assessed.server, 'check', checking(0))).toBe(201);
    const open = await rowsHolding(assessed, (rows) => Object.keys(rows).length > 0);
    const [day] = Object.values(open);

    expect(await savedWorkflow(assessed.server, 'check', checking(1))).toBe(200);
    const rows = await rowsHolding(assessed, (held) => JSON.stringify(held).includes('"verdict":"failed"'));
    const [failed] = Object.values(rows);

    expect(day).toMatchObject({ verdict: 'open' });
    expect(Object.keys(await goalRowsOf(assessed, 'goal_assessments', 'controls-hold'))).toEqual(Object.keys(open));
    expect(typeof day?.['window_opens']).toBe('number');
    expect(Object.keys(rows)).toEqual(Object.keys(open));
    expect(failed).toMatchObject({ verdict: 'failed', outcome: 'failed', window_opens: day?.['window_opens'] });
  });
});

describe('the cost of the assessor on a Node server', () => {
  it('evaluates a run that touches many assessments once each, through the deliveries they take', async () => {
    const assessed = await assessing({ ledger: aLedger(), goals: `${goalsText}${manyText}`, watching: counting });
    onTestFinished(assessed.server.stop);
    expect(await savedWorkflow(assessed.server, 'fan-out', fanningOut)).toBe(201);

    await ranOnItsSchedule(assessed, 'fan-out');
    const rows = await whenHeld(
      () => assessed.rowsOf('goal_assessments'),
      (held) => Object.keys(held).length === 10,
    );
    const { runs, tests } = await evaluatedOnceARun(assessed, 'fan-out', 8);
    const passes = assessed.asked.filter((asked) => asked === 'rows goal_clocks acme/alpha').length;

    expect(Object.values(rows).every((row) => row['verdict'] === 'passed')).toBe(true);
    expect(tests).toBe(8 * runs);
    expect(runs).toBeGreaterThan(0);
    expect(passes).toBeGreaterThanOrEqual(1);
  });

  it('reads nothing of an older playbook with no goals but whether it has a clock row, beside whether it holds a subscription, and observes none of its runs (trace D)', async () => {
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

    await minuteByMinute(
      assessed,
      () => assessed.rowsOf('goal_assessments'),
      (alphaAssessorCost) => observedWhileAsked(alphaAssessorCost, assessed.asked),
    );
    const beta = await assessed.rowsOf('goal_assessments', 'beta');
    const ofBeta = askedOfBeta(assessed.asked);

    expect(Object.keys(beta)).toEqual([]);
    expect(new Set(ofBeta.filter((asked) => asked.startsWith('rows ')))).toEqual(
      new Set(['rows goal_clocks acme/beta', 'rows event_subscriptions acme/beta']),
    );
    expect(ofBeta.filter((asked) => /goals\/goal|assessments\/|goal-refusals\//u.test(asked))).toEqual([]);
  });
});
