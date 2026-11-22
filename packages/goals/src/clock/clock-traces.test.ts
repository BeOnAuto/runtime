import type { ProjectedRow } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { controls } from '../assessor/assessor-ledger.ts';
import { goalIdentityOf } from '../assessor/assessor-ledger.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clockHarnessOf, type ClockHarness } from './clock-harness.ts';

const checking = [
  { goal: 'controls-hold', purpose: 'Checks every control each morning.', measures: '/failed', final: '/all_reported' },
];

const dayOf = (day: string) =>
  assessmentIdOf({ definition: goalIdentityOf('controls-hold'), window_start: Date.parse(`${day}T00:00:00.000Z`) });

const factsOn = (harness: ClockHarness, day: string) =>
  harness.book.factsOf('controls-hold', `assessments/${dayOf(day)}`);

async function monitored(): Promise<ClockHarness> {
  const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
  await harness.book.workflowSaved('check', 1, checking);
  await harness.goalsSaved([controls], '2026-11-08T12:00:00.000Z');
  return harness;
}

interface WeekOfChecks {
  readonly harness: ClockHarness;
  readonly mondayOpened: ProjectedRow | undefined;
  readonly monday: ProjectedRow | undefined;
  readonly tuesday: ProjectedRow | undefined;
}

async function weekOfChecks(): Promise<WeekOfChecks> {
  const harness = await monitored();
  await harness.steppedTo('2026-11-09T00:00:00.000Z');
  const mondayOpened = await harness.row(assessmentsName, dayOf('2026-11-09'));
  await harness.observed('mon', { failed: 0, all_reported: true }, '2026-11-09T09:00:00.000Z');
  await harness.steppedTo('2026-11-10T01:00:00.000Z');
  const monday = await harness.row(assessmentsName, dayOf('2026-11-09'));
  await harness.observed('tue', { failed: 0, all_reported: false }, '2026-11-10T09:00:00.000Z');
  await harness.steppedTo('2026-11-11T01:00:00.000Z');
  const tuesday = await harness.row(assessmentsName, dayOf('2026-11-10'));
  await harness.observed('wed', { failed: 0, all_reported: true }, '2026-11-11T09:00:00.000Z');
  await harness.observed('alert', { failed: 1, all_reported: false }, '2026-11-11T14:00:00.000Z');
  await harness.observed('wed-again', { failed: 0, all_reported: true }, '2026-11-11T16:00:00.000Z');
  await harness.steppedTo('2026-11-12T01:00:00.000Z');
  await harness.paused('check', '2026-11-12T08:00:00.000Z');
  await harness.steppedTo('2026-11-14T12:00:00.000Z');
  return { harness, mondayOpened, monday, tuesday };
}

describe('trace A, a daily control check, through the clock', () => {
  it('opens Monday with no run, judges it at its due from its final measurement, and tells nothing', async () => {
    const { harness, mondayOpened, monday } = await weekOfChecks();

    expect(mondayOpened).toMatchObject({
      verdict: 'open',
      window_opens: Date.parse('2026-11-09T00:00:00.000Z'),
      window_due: Date.parse('2026-11-10T01:00:00.000Z'),
      judging_due_at: Date.parse('2026-11-10T01:00:00.000Z'),
    });
    expect(monday).toMatchObject({ verdict: 'passed', verdict_told: 'quiet', judging_due_at: null });
    expect(await factsOn(harness, '2026-11-09')).toEqual(['goal_assessment_opened', 'goal_observed', 'goal_assessed']);
  });

  it('marks Tuesday overdue at its due with no final measurement, and fails it by its deadline a day later', async () => {
    const { harness, tuesday } = await weekOfChecks();

    expect(tuesday).toMatchObject({
      overdue: true,
      overdue_told: 'now',
      judging_due_at: Date.parse('2026-11-12T01:00:00.000Z'),
    });
    expect(await factsOn(harness, '2026-11-10')).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_overdue',
      'goal_assessed',
    ]);
  });
});

describe('trace A, later in the week, through the clock', () => {
  it('fails Wednesday on the crossing and takes nothing after it', async () => {
    const { harness } = await weekOfChecks();

    expect(await factsOn(harness, '2026-11-11')).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_observed',
      'goal_assessed',
    ]);
    expect(await harness.row(assessmentsName, dayOf('2026-11-11'))).toMatchObject({ verdict: 'failed' });
  });

  it('opens no window while the check is paused, and Thursday goes overdue, then fails by its deadline', async () => {
    const { harness } = await weekOfChecks();
    const rows = await harness.book.rows(assessmentsName);

    expect(await factsOn(harness, '2026-11-12')).toEqual(['goal_assessment_opened', 'goal_overdue', 'goal_assessed']);
    expect(rows[dayOf('2026-11-12')]).toMatchObject({
      outcome: 'failed',
      overdue_since: Date.parse('2026-11-13T01:00:00.000Z'),
      closed_at: Date.parse('2026-11-13T01:00:00.000Z'),
      closed_recorded_at: Date.parse('2026-11-14T01:00:00.000Z'),
    });
    expect(Object.keys(rows).toSorted()).toEqual(
      ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].map((day) => dayOf(day)).toSorted(),
    );
    expect(new Set(Object.values(rows).map((row) => row['judging_due_at']))).toEqual(new Set([null]));
  });
});

describe('trace E, a playbook that cannot run its check, through the clock', () => {
  it('goes overdue at the due of a day nothing was observed in, told at once', async () => {
    const harness = await monitored();

    await harness.observed('day-1', { failed: 0, all_reported: true }, '2026-11-09T09:00:00.000Z');
    await harness.steppedTo('2026-11-11T01:00:00.000Z');

    expect(await harness.row(assessmentsName, dayOf('2026-11-09'))).toMatchObject({ verdict: 'passed' });
    expect(await harness.row(assessmentsName, dayOf('2026-11-10'))).toMatchObject({
      verdict: 'open',
      overdue: true,
      overdue_told: 'now',
      notice_due_at: Date.parse('2026-11-11T01:00:00.000Z'),
    });
    expect(harness.wakes.map(({ at }) => new Date(at).toISOString())).toEqual([
      '2026-11-09T00:00:00.000Z',
      '2026-11-10T00:00:00.000Z',
      '2026-11-10T01:00:00.000Z',
      '2026-11-11T00:00:00.000Z',
      '2026-11-11T01:00:00.000Z',
    ]);
  });
});
