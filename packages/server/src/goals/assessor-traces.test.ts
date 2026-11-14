import { assessmentIdOf } from '@on.auto/goals';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { assessing, savedWorkflow, type Assessing } from '../testing/goals/assessed-runs.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { goalsText } from '../testing/settings/goals-kept.ts';
import { until } from '../testing/waiting/until.ts';

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
  await until(
    async () =>
      Schema.decodeUnknownSync(RunsSchema)(
        (await assessed.server.call('GET', `${alpha}/runs?type=workflow&name=${name}`)).body,
      ).runs,
    (runs) => runs.length > 0 && runs.every(({ status }) => status === 'succeeded'),
  );
}

function rowsHolding(assessed: Assessing, holds: (rows: Readonly<Record<string, unknown>>) => boolean) {
  return until(() => {
    assessed.ranAMinuteOn();
    return assessed.rowsOf('goal_assessments');
  }, holds);
}

const mar41 = assessmentIdOf({ goal: 'paying-customers', per: 'MAR-41' });

describe('trace B on a Node server, as far as the assessor reaches', () => {
  it('opens an experiment its schedule takes live, passes it on the crossing, and counts nothing a person began', async () => {
    const assessed = await served(goalsText);
    const { server } = assessed;
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

    await server.call('POST', `${alpha}/definitions/workflow/hand-live/run`, { body: { input: {} } });
    await server.call('POST', `${alpha}/definitions/workflow/parent/run`, { body: { input: {} } });
    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: 'https://example.com/tests', type: 'com.example.ping', data: {} } },
    });
    await Promise.all(['hand-live', 'parent', 'on-ping'].map((name) => succeeded(assessed, name)));
    expect(await savedWorkflow(server, 'measure', measuring)).toBe(201);
    const rows = await rowsHolding(assessed, (held) => JSON.stringify(held[mar41]).includes('"verdict":"passed"'));

    expect(Object.keys(rows)).toEqual([mar41]);
    expect(rows[mar41]).toMatchObject({ per_id: 'MAR-41', verdict: 'passed', outcome: 'passed', goals_version: 1 });
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

    expect(day).toMatchObject({ goal: 'controls-hold', verdict: 'open' });
    expect(typeof day?.['window_opens']).toBe('number');
    expect(Object.keys(rows)).toEqual(Object.keys(open));
    expect(failed).toMatchObject({ verdict: 'failed', outcome: 'failed', window_opens: day?.['window_opens'] });
  });
});
