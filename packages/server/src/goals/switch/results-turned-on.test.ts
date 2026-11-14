import { setTimeout as waited } from 'node:timers/promises';

import { describe, expect, it, onTestFinished } from 'vitest';

import { assessing, savedWorkflow, succeededRunsOf, type Assessing } from '../../testing/goals/assessed-runs.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { until } from '../../testing/waiting/until.ts';

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
  return until(
    () => {
      assessed.ranAMinuteOn();
      return succeededRunsOf(assessed, 'check');
    },
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
    await waited(3000);
    await off.server.stop();

    const on = await assessing({ ledger, goals: controlsText, results: true });
    onTestFinished(async () => {
      await on.server.stop();
    });
    expect(await savedWorkflow(on.server, 'check', checking(0))).toBe(200);
    expect(await on.server.call('POST', `${alpha}/definitions/workflow/check/resume`)).toMatchObject({ status: 200 });
    const before = await succeededRunsOf(on, 'check');
    await ranUntil(on, before + 1);
    const rows = await until(
      () => on.rowsOf('goal_assessments'),
      (held) => Object.values(held).some((row) => row['observed_at'] !== null),
    );

    expect(Object.values(rows).map((row) => row['verdict'])).toEqual(['open']);
  });
});
