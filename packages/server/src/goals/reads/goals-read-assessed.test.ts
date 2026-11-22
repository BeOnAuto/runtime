import { assessmentIdOf, GoalsReadSchema, type GoalsRead } from '@on.auto/goals';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { assessing, minuteByMinute, savedWorkflow, type Assessing } from '../../testing/goals/assessed-runs.ts';
import { goalOf } from '../../testing/goals/goal-identities.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { goalsText } from '../../testing/settings/goals-kept.ts';

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

const everyMinute = ['schedule:', '  every: PT1M'];

const issues = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `{ issue: MAR-${String(from + index)} }`).join(', ');

const marking = (milestone: string, from: number, to: number) => [
  'contributes:',
  '  - goal: paying-customers',
  `    purpose: Marks each experiment ${milestone}.`,
  '    each: /experiments',
  '    per_id: /issue',
  `    marks: ${milestone}`,
  ...everyMinute,
  'do:',
  `  - mark: { set: { experiments: [${issues(from, to)}] } }`,
];

const measuring = (customers: string) => [
  'contributes:',
  '  - goal: paying-customers',
  '    purpose: Measures what each experiment brought in.',
  '    each: /results',
  '    per_id: /issue',
  '    measures: /customers',
  ...everyMinute,
  'do:',
  `  - count: { set: { results: [{ issue: MAR-3, customers: ${customers} }] } }`,
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

const exactly = Schema.decodeUnknownSync(GoalsReadSchema, { onExcessProperty: 'error' });

async function served(): Promise<Assessing> {
  const ledger = temporaryLedger();
  const assessed = await assessing({ ledger, goals: `${goalsText}${controlsText}` });
  onTestFinished(async () => {
    await assessed.server.stop();
    ledger.remove();
  });
  return assessed;
}

async function goalsRead(assessed: Assessing): Promise<GoalsRead> {
  const { status, body } = await assessed.server.call('GET', `${alpha}/goals`);
  expect(status).toBe(200);
  return exactly(body);
}

function readHolding(assessed: Assessing, holds: (read: GoalsRead) => boolean): Promise<GoalsRead> {
  return minuteByMinute(assessed, () => goalsRead(assessed), holds);
}

const experimentsOf = (read: GoalsRead) => read.goals[0]?.assessments;

const controlsOf = (read: GoalsRead) => read.goals.find(({ id }) => id === 'controls-hold')?.assessments;

function threeMilestonesMarked(read: GoalsRead): boolean {
  const counted = experimentsOf(read)?.by_milestone;
  const settled = counted?.['chosen'] === 14 && counted['prepared'] === 2 && counted['live'] === 1;
  return settled && experimentsOf(read)?.in_flight[0]?.next === 'measured';
}

function onePassedOfFourteen(read: GoalsRead): boolean {
  return experimentsOf(read)?.closed.passed === 1 && experimentsOf(read)?.open_count === 13;
}

function theDayFailedAndNoneOpen(read: GoalsRead): boolean {
  return controlsOf(read)?.closed.failed === 1 && controlsOf(read)?.open_count === 0;
}

function refusedEvidenceShown(read: GoalsRead): boolean {
  return (read.goals[0]?.gaps ?? []).some(({ kind }) => kind === 'observation_refused');
}

const mar = (definition: string, index: number) => assessmentIdOf({ definition, per: `MAR-${String(index)}` });

describe('the goals read of a Node server whose schedules judge things', () => {
  it('counts the experiments by milestone, lists twelve in flight with the one that has a due first, and passes it', async () => {
    const assessed = await served();
    expect(await savedWorkflow(assessed.server, 'choose', marking('chosen', 1, 14))).toBe(201);
    expect(await savedWorkflow(assessed.server, 'prepare', marking('prepared', 2, 3))).toBe(201);
    expect(await savedWorkflow(assessed.server, 'go-live', marking('live', 3, 3))).toBe(201);
    const marked = await readHolding(assessed, threeMilestonesMarked);
    const experiments = await goalOf(assessed, 'paying-customers');

    expect(experimentsOf(marked)).toMatchObject({
      open_count: 14,
      by_milestone: { chosen: 14, prepared: 2, live: 1, measured: 0 },
      waiting: { chosen: 0, prepared: 12, live: 1, measured: 1 },
      current: { verdict: 'open' },
    });
    expect(experimentsOf(marked)?.in_flight).toHaveLength(12);
    expect(experimentsOf(marked)?.in_flight[0]).toMatchObject({
      id: mar(experiments, 3),
      per: { id: 'MAR-3' },
      next: 'measured',
      marks: [{ milestone: 'chosen' }, { milestone: 'prepared' }, { milestone: 'live' }],
    });
    expect(experimentsOf(marked)?.in_flight[0]?.window).toBeDefined();

    expect(await savedWorkflow(assessed.server, 'measure', measuring('1'))).toBe(201);
    const passed = await readHolding(assessed, onePassedOfFourteen);

    expect(experimentsOf(passed)?.open_count).toBe(13);
    expect(experimentsOf(passed)?.closed).toMatchObject({
      total: 1,
      passed: 1,
      latest: [{ id: mar(experiments, 3), outcome: 'passed', per: { id: 'MAR-3' }, value: 1 }],
    });
  });
});

describe('the goals read of a Node server that could not read the evidence of a run', () => {
  it('shows evidence it could not read as a gap of the goal, naming the workflow', async () => {
    const assessed = await served();
    expect(await savedWorkflow(assessed.server, 'go-live', marking('live', 3, 3))).toBe(201);
    expect(await savedWorkflow(assessed.server, 'measure', measuring('many'))).toBe(201);
    const refused = await readHolding(assessed, refusedEvidenceShown);

    expect(refused.goals[0]?.gaps.find(({ kind }) => kind === 'observation_refused')).toMatchObject({
      goal: 'paying-customers',
      workflow: 'measure',
      fixed_by: 'agent',
    });
  });
});

describe('the goals read of a Node server whose schedule checks a day', () => {
  it('makes the open day current, then the day its later check failed', async () => {
    const assessed = await served();
    expect(await savedWorkflow(assessed.server, 'check', checking(0))).toBe(201);
    const open = await readHolding(assessed, (read) => controlsOf(read)?.open_count === 1);

    expect(await savedWorkflow(assessed.server, 'check', checking(1))).toBe(200);
    const failed = await readHolding(assessed, theDayFailedAndNoneOpen);

    expect(controlsOf(open)).toMatchObject({
      current: { verdict: 'open', measurement: { value: 0, final: true }, final_measurement: { value: 0 } },
      by_milestone: {},
      waiting: {},
    });
    expect(controlsOf(failed)).toMatchObject({
      open_count: 0,
      current: { id: controlsOf(open)?.current?.id, verdict: 'failed', measurement: { value: 1 } },
      closed: { total: 1, failed: 1, latest: [{ outcome: 'failed', value: 1 }] },
    });
  });
});

const ChangesBody = Schema.Struct({ cursor: Schema.String, changes: Schema.Array(Schema.Unknown) });

describe('the changes of a playbook whose schedules judge things', () => {
  it('names a goal change when an assessment opens', async () => {
    const assessed = await served();
    const { server } = assessed;
    const { cursor } = Schema.decodeUnknownSync(ChangesBody)((await server.call('GET', `${alpha}/changes`)).body);
    expect(await savedWorkflow(server, 'go-live', marking('live', 3, 3))).toBe(201);
    await readHolding(assessed, (read) => experimentsOf(read)?.open_count === 1);
    const changed = await server.call('GET', `${alpha}/changes?since=${cursor}&wait=0`);

    expect(JSON.stringify(changed.body)).toContain('{"kind":"goal"}');
  });
});
