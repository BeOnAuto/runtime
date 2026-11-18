import { describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  assessing,
  ranOnItsSchedule,
  savedWorkflow,
  succeededRunsOf,
  type Assessing,
} from '../testing/goals/assessed-runs.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { until } from '../testing/waiting/until.ts';

const day = 86_400_000;
const hour = 3_600_000;

const goalsOf = (id: string) =>
  [
    `- id: ${id}`,
    `  statement: Every ${id} control passes its daily check.`,
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

const reporting = (goal: string, schedule: readonly string[]) => [
  'contributes:',
  `  - goal: ${goal}`,
  '    purpose: Checks every control each day.',
  '    measures: /failed',
  '    final: /all_reported',
  ...schedule,
  'do:',
  '  - check: { set: { failed: 0, all_reported: true } }',
];

async function served(goals: string): Promise<Assessing> {
  const ledger = temporaryLedger();
  const assessed = await assessing({ ledger, goals });
  onTestFinished(async () => {
    await assessed.server.stop();
    ledger.remove();
  });
  return assessed;
}

type Rows = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

const ofGoal = (rows: Rows, goal: string, opens?: unknown) =>
  Object.values(rows).filter((row) => row['goal'] === goal && (opens === undefined || row['window_opens'] === opens));

function rowsHolding(assessed: Assessing, holds: (rows: Rows) => boolean): Promise<Rows> {
  return until(() => assessed.rowsOf('goal_assessments'), holds);
}

async function reportedToday(assessed: Assessing, today: number): Promise<void> {
  await ranOnItsSchedule(assessed, 'check');
  const rows = await rowsHolding(assessed, (held) =>
    ofGoal(held, 'checked-daily', today).some((row) => row['observed_at'] !== null),
  );
  expect(ofGoal(rows, 'never-checked')).toEqual([]);
  expect(ofGoal(rows, 'checked-daily', today)).toHaveLength(1);
}

async function openedWithNoRun(assessed: Assessing, today: number, tomorrow: number): Promise<void> {
  assessed.clock.moveTo(tomorrow);
  const rows = await rowsHolding(assessed, (held) => ofGoal(held, 'never-checked', tomorrow).length === 1);
  expect(ofGoal(rows, 'never-checked', tomorrow)[0]).toMatchObject({
    verdict: 'open',
    open: true,
    overdue: false,
    observed_at: null,
    window_closes: tomorrow + day,
    window_due: tomorrow + day + hour,
    judging_due_at: tomorrow + day + hour,
    no_result_at: tomorrow + 2 * day + hour,
  });
  expect(ofGoal(rows, 'checked-daily', today)[0]).toMatchObject({ verdict: 'open', open: true });
}

async function passedAtItsDue(assessed: Assessing, today: number, tomorrow: number): Promise<void> {
  assessed.clock.moveTo(tomorrow + hour);
  const rows = await rowsHolding(assessed, (held) => ofGoal(held, 'checked-daily', today)[0]?.['outcome'] === 'passed');
  expect(ofGoal(rows, 'checked-daily', today)[0]).toMatchObject({
    verdict: 'passed',
    verdict_at: tomorrow + hour,
    verdict_told: 'quiet',
    open: false,
    judging_due_at: null,
  });
  expect(ofGoal(rows, 'never-checked', tomorrow)[0]).toMatchObject({ overdue: false, open: true });
}

async function overdueAfterItsDue(assessed: Assessing, tomorrow: number): Promise<void> {
  assessed.clock.moveTo(tomorrow + day + hour);
  const rows = await rowsHolding(assessed, (held) => ofGoal(held, 'never-checked', tomorrow)[0]?.['overdue'] === true);
  expect(ofGoal(rows, 'never-checked', tomorrow)[0]).toMatchObject({
    verdict: 'open',
    overdue_since: tomorrow + day + hour,
    overdue_told: 'now',
    outcome: null,
    open: true,
    judging_due_at: tomorrow + 2 * day + hour,
  });
}

async function missedByItsDeadline(assessed: Assessing, today: number, tomorrow: number): Promise<void> {
  assessed.clock.moveTo(tomorrow + 2 * day + hour);
  const rows = await rowsHolding(
    assessed,
    (held) => ofGoal(held, 'never-checked', tomorrow)[0]?.['outcome'] === 'failed',
  );
  expect(ofGoal(rows, 'never-checked', tomorrow)[0]).toMatchObject({
    verdict: 'failed',
    verdict_at: tomorrow + day + hour,
    open: false,
    closed_at: tomorrow + day + hour,
    closed_recorded_at: tomorrow + 2 * day + hour,
    judging_due_at: null,
  });
  expect(ofGoal(rows, 'checked-daily', today)[0]).toMatchObject({ outcome: 'passed' });
}

describe('trace A on a Node server, as the clock moves', () => {
  it('opens a day with no run, judges a reported day at its due, calls an unreported day overdue, and fails it by its deadline', async () => {
    const assessed = await served(`${goalsOf('checked-daily')}${goalsOf('never-checked')}`);
    expect(
      await savedWorkflow(assessed.server, 'check', reporting('checked-daily', ['schedule:', '  every: PT1M'])),
    ).toBe(201);
    expect(await savedWorkflow(assessed.server, 'silent', reporting('never-checked', []))).toBe(201);
    const today = Math.floor(assessed.clock.now() / day) * day;
    const tomorrow = today + day;

    await reportedToday(assessed, today);
    await openedWithNoRun(assessed, today, tomorrow);
    await passedAtItsDue(assessed, today, tomorrow);
    await overdueAfterItsDue(assessed, tomorrow);
    await missedByItsDeadline(assessed, today, tomorrow);
  });
});

const releasedGoal = (id: string, settles: string) =>
  [
    `- id: ${id}`,
    `  statement: Every release ships with no ${id}.`,
    '  per: release',
    '  window: { after: live, for: P1D, grace: PT1H }',
    '  success:',
    '    label: Defects found',
    `    settles: ${settles}`,
    '    target: { at_most: 0 }',
    '    passed: Shipped clean',
    '    failed: Shipped with defects',
    '  milestones:',
    '    - { id: built, label: Built, by: auto }',
    '    - { id: live, label: Released, by: auto }',
    '    - { id: reviewed, label: Reviewed, by: person }',
    '  notify: { passed: quiet, failed: quiet, overdue: quiet }',
    '',
  ].join('\n');

const releaseEntry = (goal: string, readAt: string | undefined, split: boolean) => [
  `  - goal: ${goal}`,
  '    purpose: Releases the build and counts its defects.',
  '    per_id: /id',
  ...(split ? ['    marks: live', `  - goal: ${goal}`, '    purpose: Counts its defects.', '    per_id: /id'] : []),
  ...(split ? [] : ['    marks: live']),
  '    measures: /defects',
  ...(readAt === undefined ? [] : ['    as_of: /read_at']),
];

const releasing = (readAt: string | undefined, split: boolean) => [
  'contributes:',
  ...releaseEntry('found-at-once', readAt, split),
  ...releaseEntry('found-by-the-close', readAt, split),
  '    final: true',
  'schedule:',
  '  every: PT1M',
  'do:',
  `  - release: { set: { id: R-1, defects: 1${readAt === undefined ? '' : `, read_at: '${readAt}'`} } }`,
];

const readAtOf = (early: boolean, now: number) => (early ? new Date(now).toISOString() : undefined);

const finalAsOf = (readAt: string | undefined, opens: unknown) => (readAt === undefined ? opens : Date.parse(readAt));

const bothMarked = (held: Rows) =>
  ofGoal(held, 'found-at-once')[0]?.['outcome'] === 'failed' && ofGoal(held, 'found-by-the-close').length === 1;

describe('an after window opened by the scheduled run that measures in it, on a Node server', () => {
  it.each([
    ['as of the run end', false, false],
    ['as of when it read its source, before the run ended', true, false],
    ['in another contribution, as of when it read its source, before the run ended', true, true],
  ])(
    'fails a crossing at once and judges a final at its due, both measured by the run that marked the milestone, %s',
    async (_, early, split) => {
      const assessed = await served(
        `${releasedGoal('found-at-once', 'on_crossing')}${releasedGoal('found-by-the-close', 'at_close')}`,
      );
      const readAt = readAtOf(early, assessed.clock.now());
      expect(await savedWorkflow(assessed.server, 'release', releasing(readAt, split))).toBe(201);

      assessed.ranAMinuteOn();
      await until(
        () => succeededRunsOf(assessed, 'release'),
        (runs) => runs > 0,
      );
      const marked = await rowsHolding(assessed, bothMarked);
      const [atOnce] = ofGoal(marked, 'found-at-once');
      const [byTheClose] = ofGoal(marked, 'found-by-the-close');
      expect(atOnce).toMatchObject({ verdict: 'failed', verdict_at: atOnce?.['window_opens'] });
      expect(byTheClose).toMatchObject({ verdict: 'open', window_opens: atOnce?.['window_opens'] });
      expect(JSON.parse(String(byTheClose?.['state']))).toMatchObject({
        finalMeasurement: { value: 1, as_of: finalAsOf(readAt, atOnce?.['window_opens']) },
      });

      assessed.clock.moveTo(Number(byTheClose?.['window_due']));
      const judged = await rowsHolding(
        assessed,
        (held) => ofGoal(held, 'found-by-the-close')[0]?.['outcome'] === 'failed',
      );
      expect(ofGoal(judged, 'found-by-the-close')[0]).toMatchObject({
        verdict: 'failed',
        verdict_at: byTheClose?.['window_due'],
        overdue: false,
        open: false,
      });
    },
  );
});

async function movedThroughDays(assessed: Assessing, from: number, days: number): Promise<void> {
  if (days === 0) {
    return;
  }
  await assessed.clock.quietAt(from + day, () => assessed.asked.length);
  await movedThroughDays(assessed, from + day, days - 1);
}

const clockRowOf = async (assessed: Assessing) => Object.values(await assessed.rowsOf('goal_clocks'))[0];

describe('a daily goal on a Node server whose only contribution is paused', () => {
  it('is due once a day while paused and opens nothing, and after a resume opens the next day, not the day it was resumed in', async () => {
    const assessed = await served(goalsOf('checked-daily'));
    expect(await savedWorkflow(assessed.server, 'check', reporting('checked-daily', []))).toBe(201);
    const paused = await assessed.server.call(
      'POST',
      '/v1/orgs/acme/playbooks/alpha/definitions/workflow/check/pause',
      {
        body: {},
      },
    );
    const midnight = Math.floor(assessed.clock.now() / day) * day + day;
    assessed.clock.moveTo(midnight + 1000);
    const quiet = await until(
      () => clockRowOf(assessed),
      (row) => row?.['opens_at'] === midnight + day,
    );
    await movedThroughDays(assessed, midnight + 1000, 3);
    const whilePaused = ofGoal(await assessed.rowsOf('goal_assessments'), 'checked-daily');
    const resumedAt = midnight + 3 * day + 10 * hour;
    assessed.clock.moveTo(resumedAt);
    const mocked = vi.spyOn(Date, 'now').mockReturnValue(resumedAt);
    const resumed = await assessed.server
      .call('POST', '/v1/orgs/acme/playbooks/alpha/definitions/workflow/check/resume', { body: {} })
      .finally(() => {
        mocked.mockRestore();
      });
    const afterTheResume = await clockRowOf(assessed);
    const resumedDay = ofGoal(await assessed.rowsOf('goal_assessments'), 'checked-daily');
    assessed.clock.moveTo(midnight + 4 * day + 1000);
    const rows = await rowsHolding(assessed, (held) => ofGoal(held, 'checked-daily').length === 1);

    expect(paused.status).toBe(200);
    expect(quiet).toMatchObject({ opens_at: midnight + day });
    expect(whilePaused).toEqual([]);
    expect(resumed.status).toBe(200);
    expect(afterTheResume).toMatchObject({ opens_at: midnight + 4 * day });
    expect(resumedDay).toEqual([]);
    expect(ofGoal(rows, 'checked-daily')[0]).toMatchObject({ window_opens: midnight + 4 * day, open: true });
    expect((await clockRowOf(assessed))?.['opens_at']).toBe(midnight + 5 * day);
  });
});
