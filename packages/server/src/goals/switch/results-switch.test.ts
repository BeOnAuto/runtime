import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  assessing,
  minuteByMinute,
  ranOnItsSchedule,
  savedWorkflow,
  succeededRunsOf,
  type Assessing,
} from '../../testing/goals/assessed-runs.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { whenHeld } from '../../testing/waiting/until.ts';

const day = 86_400_000;

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

const failingCheck = [
  'contributes:',
  '  - goal: controls-hold',
  '    purpose: Checks every control each day.',
  '    measures: /failed',
  '    final: /all_reported',
  'schedule:',
  '  every: PT1M',
  'do:',
  '  - check: { set: { failed: 1, all_reported: true } }',
];

const RunsSchema = Schema.Struct({
  runs: Schema.Array(Schema.Struct({ status: Schema.String, name: Schema.optionalKey(Schema.String) })),
});

const ActivitySchema = Schema.Struct({
  rows: Schema.Array(Schema.Struct({ kind: Schema.String })),
  counts: Schema.Struct({ goals: Schema.Number }),
});

const GoalsSchema = Schema.Struct({
  results: Schema.Boolean,
  goals: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      assessments: Schema.Struct({ current: Schema.NullOr(Schema.Unknown), open_count: Schema.Number }),
    }),
  ),
});

async function served(results: boolean): Promise<Assessing> {
  const ledger = temporaryLedger();
  const assessed = await assessing({ ledger, goals: controlsText, results });
  onTestFinished(async () => {
    await assessed.server.stop();
    ledger.remove();
  });
  return assessed;
}

async function ranTwiceOverTwoDays(assessed: Assessing): Promise<number> {
  expect(await savedWorkflow(assessed.server, 'check', failingCheck)).toBe(201);
  await ranOnItsSchedule(assessed, 'check');
  assessed.clock.moveTo(assessed.clock.now() + 2 * day);
  return minuteByMinute(
    assessed,
    () => succeededRunsOf(assessed, 'check'),
    (runs) => runs > 1,
  );
}

async function bellOf(assessed: Assessing) {
  const listed = await assessed.server.call('GET', '/v1/orgs/acme/activity?kind=goal,goal_overdue');
  expect(listed.status).toBe(200);
  return Schema.decodeUnknownSync(ActivitySchema)(listed.body);
}

async function goalsOf(assessed: Assessing) {
  const read = await assessed.server.call('GET', `${alpha}/goals`);
  expect(read.status).toBe(200);
  return Schema.decodeUnknownSync(GoalsSchema)(read.body);
}

async function runNamesOf(assessed: Assessing): Promise<readonly string[]> {
  const listed = await assessed.server.call('GET', `${alpha}/runs`);
  return Schema.decodeUnknownSync(RunsSchema)(listed.body).runs.map(({ name }) => name ?? '');
}

const engineWork = (asked: string) =>
  asked === 'rows goal_clocks acme/alpha' ||
  asked.startsWith('execute playbook/acme/alpha/assessments/') ||
  asked.startsWith('execute playbook/acme/alpha/goal-refusals');

describe('a Node server that keeps goals with results off', () => {
  it('takes the goals and the contributing workflow, runs it over two days and judges nothing', async () => {
    const assessed = await served(false);
    const runs = await ranTwiceOverTwoDays(assessed);

    const engineAsked = assessed.asked.filter(engineWork);

    expect(runs).toBeGreaterThan(1);
    expect(engineAsked).toEqual([]);
    expect(await assessed.rowsOf('goal_assessments')).toEqual({});
    expect(Object.keys(await assessed.rowsOf('goal_clocks'))).toHaveLength(1);
    expect(await goalsOf(assessed)).toMatchObject({
      results: false,
      goals: [{ id: 'controls-hold', assessments: { current: null, open_count: 0 } }],
    });
    expect(await bellOf(assessed)).toMatchObject({ rows: [], counts: { goals: 0 } });
    expect(new Set(await runNamesOf(assessed))).toEqual(new Set(['check']));
  });

  it('judges the same runs and lists the failure in the bell once results are on, as the trunk does', async () => {
    const assessed = await served(true);
    await ranTwiceOverTwoDays(assessed);

    const bell = await whenHeld(
      () => bellOf(assessed),
      ({ rows }) => rows.length > 0,
    );
    expect(bell.rows[0]).toMatchObject({ kind: 'goal' });
    expect(Object.keys(await assessed.rowsOf('goal_assessments')).length).toBeGreaterThan(0);
    expect(assessed.asked.filter(engineWork).length).toBeGreaterThan(0);
    expect((await goalsOf(assessed)).results).toBe(true);
  });
});

const checking = (failed: number) => [
  'contributes:',
  '  - goal: controls-hold',
  '    purpose: Checks every control each day.',
  '    measures: /failed',
  'schedule:',
  '  every: PT1M',
  'do:',
  `  - check: { set: { failed: ${String(failed)} } }`,
];

function ranUntil(assessed: Assessing, runs: number): Promise<number> {
  return minuteByMinute(
    assessed,
    () => succeededRunsOf(assessed, 'check'),
    (succeeded) => succeeded >= runs,
  );
}

describe('a Node server whose results are turned on after runs ended with them off', () => {
  it('judges the runs that end after the turn-on and never the runs that ended before it', async () => {
    const ledger = temporaryLedger();
    onTestFinished(() => {
      ledger.remove();
    });
    const off = await assessing({ ledger, goals: controlsText, results: false });
    expect(await savedWorkflow(off.server, 'check', checking(1))).toBe(201);
    await ranUntil(off, 1);
    expect(await off.server.call('POST', `${alpha}/definitions/workflow/check/pause`)).toMatchObject({ status: 200 });
    await off.clock.quietAt(off.clock.now(), () => off.asked.length);
    await off.server.stop();

    const on = await assessing({ ledger, goals: controlsText, results: true });
    onTestFinished(async () => {
      await on.server.stop();
    });
    expect(await savedWorkflow(on.server, 'check', checking(0))).toBe(200);
    expect(await on.server.call('POST', `${alpha}/definitions/workflow/check/resume`)).toMatchObject({ status: 200 });
    const before = await succeededRunsOf(on, 'check');
    await ranUntil(on, before + 1);
    const rows = await whenHeld(
      () => on.rowsOf('goal_assessments'),
      (held) => Object.values(held).some((row) => row['observed_at'] !== null),
    );

    expect(Object.values(rows).map((row) => row['verdict'])).toEqual(['open']);
  });
});
