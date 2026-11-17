import type { DueWork } from '@on.auto/workflow-host';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { bookOf, controls, sales } from '../assessor/assessor-ledger.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clockKey, clocksName } from '../goal-tables/clock-rows.ts';
import { type ClockHarness, clockHarnessOf } from './clock-harness.ts';
import type { ClockPorts } from './clock-judging.ts';
import { goalsClockOf } from './goals-clock.ts';

const checking = [{ goal: 'controls-hold', purpose: 'Checks every control each morning.', measures: '/failed' }];

function idle(ports: ClockPorts): DueWork {
  const clock = goalsClockOf(ports);
  return {
    ...clock,
    due: (now, most, callsOut) =>
      Effect.map(clock.due(now, most, callsOut), (items) =>
        items.map((item) => ({ ...item, perform: () => Effect.void })),
      ),
  };
}

describe('the harness of the clock', () => {
  it('fails a moment at which a perform left its row due, as a host would spin on it', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z', bookOf(), idle);
    await harness.book.workflowSaved('check', 1, checking);

    await expect(harness.goalsSaved([controls], '2026-11-09T00:00:00.000Z')).rejects.toThrow(
      `Rows left due at 2026-11-09T00:00:00.000Z: ${sales.org}/${sales.playbook}/${clocksName}/${clockKey}`,
    );
  });
});

const inLosAngeles = { ...controls, window: { calendar: 'day', time_zone: 'America/Los_Angeles' } };

const costPerLead = {
  id: 'cost-per-lead',
  statement: 'Keep what a lead costs us under fifty each week.',
  window: { calendar: 'week', time_zone: 'America/Los_Angeles', grace: 'PT8H' },
  success: {
    label: 'Cost per lead',
    settles: 'at_close',
    target: { at_most: 50 },
    passed: 'Leads came cheap',
    failed: 'Leads cost too much',
  },
  notify: { passed: 'now', failed: 'now', overdue: 'now', through: 'tell-owner' },
};

const costing = [
  {
    goal: 'cost-per-lead',
    purpose: 'Totals what each lead cost.',
    measures: '/cost',
    final: '/final',
    as_of: '/through',
  },
];

const iso = (at: unknown) => new Date(Number(at)).toISOString();

async function windowsOf(harness: ClockHarness): Promise<readonly string[]> {
  const rows = Object.values(await harness.book.rows(assessmentsName));
  return rows
    .map((row) => [iso(row['window_opens']), iso(row['window_closes']), iso(row['window_due'])].join(' '))
    .toSorted();
}

async function checked(goal: Schema.Json, savedAt: string, start = '2026-01-01T00:00:00.000Z'): Promise<ClockHarness> {
  const harness = clockHarnessOf(start);
  await harness.book.workflowSaved('check', 1, checking);
  await harness.goalsSaved([goal], savedAt);
  return harness;
}

describe('a day window in Los Angeles', () => {
  it('is 23 hours on the day the clocks go forward, each window opened at local midnight', async () => {
    const harness = await checked(inLosAngeles, '2026-03-06T12:00:00.000Z');

    await harness.until('2026-03-10T07:00:00.000Z');

    expect(await windowsOf(harness)).toEqual([
      '2026-03-07T08:00:00.000Z 2026-03-08T08:00:00.000Z 2026-03-08T09:00:00.000Z',
      '2026-03-08T08:00:00.000Z 2026-03-09T07:00:00.000Z 2026-03-09T08:00:00.000Z',
      '2026-03-09T07:00:00.000Z 2026-03-10T07:00:00.000Z 2026-03-10T08:00:00.000Z',
      '2026-03-10T07:00:00.000Z 2026-03-11T07:00:00.000Z 2026-03-11T08:00:00.000Z',
    ]);
  });

  it('is 25 hours on the day the clocks go back', async () => {
    const harness = await checked(inLosAngeles, '2026-10-30T12:00:00.000Z');

    await harness.until('2026-11-02T08:00:00.000Z');

    expect(await windowsOf(harness)).toEqual([
      '2026-10-31T07:00:00.000Z 2026-11-01T07:00:00.000Z 2026-11-01T08:00:00.000Z',
      '2026-11-01T07:00:00.000Z 2026-11-02T08:00:00.000Z 2026-11-02T09:00:00.000Z',
      '2026-11-02T08:00:00.000Z 2026-11-03T08:00:00.000Z 2026-11-03T09:00:00.000Z',
    ]);
    expect(harness.wakes.map(({ at }) => iso(at)).filter((at) => at >= '2026-11-01T00:00:00.000Z')).toEqual([
      '2026-11-01T07:00:00.000Z',
      '2026-11-01T08:00:00.000Z',
      '2026-11-02T08:00:00.000Z',
    ]);
  });
});

describe('trace C, a weekly cost per lead in Los Angeles, through the clock', () => {
  it('keeps daily numbers as progress and judges the week at Monday 08:00 local from the final number through its close', async () => {
    const harness = clockHarnessOf('2026-10-20T00:00:00.000Z');
    await harness.book.workflowSaved('cost', 1, costing);
    await harness.goalsSaved([costPerLead], '2026-10-25T12:00:00.000Z');
    const week = assessmentIdOf({ goal: 'cost-per-lead', window_start: Date.parse('2026-10-26T07:00:00.000Z') });
    const progress = { cost: 70, final: false, through: '2026-10-28T00:00:00-07:00' };
    const closing = { cost: 42, final: true, through: '2026-11-02T00:00:00-08:00' };

    await harness.observed('wed', progress, '2026-10-28T15:00:00.000Z', 'cost');
    await harness.until('2026-11-02T08:00:00.000Z');
    await harness.observed('mon', closing, '2026-11-02T15:00:00.000Z', 'cost');
    await harness.until('2026-11-02T15:59:59.999Z');
    const beforeDue = await harness.row(assessmentsName, week);
    await harness.until('2026-11-02T16:00:00.000Z');

    expect(beforeDue).toMatchObject({ verdict: 'open', judging_due_at: Date.parse('2026-11-02T16:00:00.000Z') });
    expect(await harness.row(assessmentsName, week)).toMatchObject({
      verdict: 'passed',
      verdict_at: Date.parse('2026-11-02T16:00:00.000Z'),
      window_closes: Date.parse('2026-11-02T08:00:00.000Z'),
    });
    expect(await windowsOf(harness)).toEqual([
      '2026-10-26T07:00:00.000Z 2026-11-02T08:00:00.000Z 2026-11-02T16:00:00.000Z',
      '2026-11-02T08:00:00.000Z 2026-11-09T08:00:00.000Z 2026-11-09T16:00:00.000Z',
    ]);
  });
});

describe('the first save of a goal', () => {
  it('opens no window that started before it, only the next one', async () => {
    const harness = await checked(controls, '2026-11-09T12:00:00.000Z');

    await harness.until('2026-11-10T12:00:00.000Z');

    expect(await windowsOf(harness)).toEqual([
      '2026-11-10T00:00:00.000Z 2026-11-11T00:00:00.000Z 2026-11-11T01:00:00.000Z',
    ]);
  });
});

describe('downtime across several windows', () => {
  it('opens only the current window and settles what fell due meanwhile in one wake', async () => {
    const harness = await checked(controls, '2026-11-08T12:00:00.000Z');
    await harness.until('2026-11-09T00:00:00.000Z');
    const monday = assessmentIdOf({ goal: 'controls-hold', window_start: Date.parse('2026-11-09T00:00:00.000Z') });

    const performs = await harness.performedAt(Date.parse('2026-11-12T12:00:00.000Z'));

    expect(performs).toBe(2);
    expect(await windowsOf(harness)).toEqual([
      '2026-11-09T00:00:00.000Z 2026-11-10T00:00:00.000Z 2026-11-10T01:00:00.000Z',
      '2026-11-12T00:00:00.000Z 2026-11-13T00:00:00.000Z 2026-11-13T01:00:00.000Z',
    ]);
    expect(await harness.book.factsOf(`assessments/${monday}`)).toEqual([
      'goal_assessment_opened',
      'goal_overdue',
      'goal_assessed',
    ]);
    expect(await harness.row(assessmentsName, monday)).toMatchObject({
      outcome: 'failed',
      overdue_since: Date.parse('2026-11-10T01:00:00.000Z'),
    });
  });
});
