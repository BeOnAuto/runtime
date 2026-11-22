import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { experimentId, measuring, results } from '../assessor/assessor-fixtures.ts';
import { controls, deliveredAll, experiments, finished } from '../assessor/assessor-ledger.ts';
import { goalIdentityOf } from '../assessor/assessor-ledger.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clockKey, clocksName } from '../goal-tables/clock-rows.ts';
import { clockHarnessOf, type ClockHarness } from './clock-harness.ts';
import { mostEndedInARead } from './clock-row-work.ts';
import { mostHeldInARead } from './retired-day.ts';

const checking = [{ goal: 'controls-hold', purpose: 'Checks every control each morning.', measures: '/failed' }];

const dayOf = (day: string) =>
  assessmentIdOf({ definition: goalIdentityOf('controls-hold'), window_start: Date.parse(`${day}T00:00:00.000Z`) });

const stamps = (harness: ClockHarness) =>
  harness.wakes.map(({ at, performs }) => `${new Date(at).toISOString()} ${String(performs)}`);

const launches = {
  id: 'launches',
  statement: 'Every launch brings a customer within its first hour.',
  per: 'launch',
  window: { after: 'live', for: 'PT1H', grace: 'PT1M' },
  success: {
    label: 'Customers',
    settles: 'on_crossing',
    target: { at_least: 1 },
    passed: 'The launch landed',
    failed: 'The launch fell flat',
  },
  milestones: [{ id: 'live', label: 'Taken live', by: 'auto' }],
  notify: { passed: 'now', failed: 'now', overdue: 'now', through: 'tell-owner' },
};

const launching = [
  {
    goal: 'launches',
    purpose: 'Takes each launch live.',
    each: '/results',
    per_id: '/issue',
    marks: 'live',
    measures: '/customers',
  },
];

async function duesOf(harness: ClockHarness) {
  const assessments = await harness.book.rows(assessmentsName);
  return {
    clock: (await harness.row(clocksName, clockKey))?.['opens_at'],
    assessments: Object.keys(assessments).map((key) => [key, assessments[key]?.['judging_due_at']].join(' ')),
  };
}

async function monitored(): Promise<ClockHarness> {
  const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
  await harness.book.workflowSaved('check', 1, checking);
  await harness.goalsSaved([controls], '2026-11-08T12:00:00.000Z');
  await harness.steppedTo('2026-11-09T12:00:00.000Z');
  return harness;
}

describe('a retired goal', () => {
  it('ends every open assessment it has, those with no due among them, in the wake its save makes', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.book.workflowSaved('measure', 1, measuring);
    await harness.goalsSaved([experiments], '2026-11-08T12:00:00.000Z');
    const counts = Array.from({ length: mostEndedInARead + 1 }, () => 0);
    await harness.observed('r1', results(...counts).output, '2026-11-09T09:00:00.000Z', 'measure');

    await harness.goalsSaved([{ ...experiments, retired: true }], '2026-11-10T09:00:00.000Z');
    const rows = Object.values(await harness.book.rows(assessmentsName));

    expect(rows).toHaveLength(mostEndedInARead + 1);
    expect(new Set(rows.map((row) => `${String(row['outcome'])} ${String(row['notice_due_at'])}`))).toEqual(
      new Set(['goal_retired null']),
    );
    expect(await harness.book.factsOf('paying-customers', `assessments/${experimentId('MAR-41')}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_assessment_ended',
    ]);
    expect(await harness.row(clocksName, clockKey)).toMatchObject({ opens_at: null });
    expect(stamps(harness)).toEqual(['2026-11-10T09:00:00.000Z 1']);
  });

  it('ends its calendar assessments too, and opens no window of it again', async () => {
    const harness = await monitored();

    await harness.goalsSaved([{ ...controls, retired: true }], '2026-11-09T12:00:00.000Z');
    await harness.steppedTo('2026-11-12T00:00:00.000Z');

    expect(await harness.row(assessmentsName, dayOf('2026-11-09'))).toMatchObject({
      outcome: 'goal_retired',
      judging_due_at: null,
    });
    expect(Object.keys(await harness.book.rows(assessmentsName))).toEqual([dayOf('2026-11-09')]);
    expect(stamps(harness)).toEqual(['2026-11-09T00:00:00.000Z 1', '2026-11-09T12:00:00.000Z 1']);
  });
});

describe('a goal retired just before another goal’s window opens', () => {
  it('ends what it left open in the clock’s next wake, though the opening came first', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.book.workflowSaved('measure', 1, measuring);
    await harness.goalsSaved([experiments, controls], '2026-11-08T12:00:00.000Z');
    await harness.observed('r1', results(0).output, '2026-11-09T09:00:00.000Z', 'measure');
    await harness.book.workflowSaved('check', 1, checking);
    const opening = Date.parse('2026-11-09T10:00:30.000Z');

    await harness.book.goalsSaved([{ ...experiments, retired: true }, controls], '2026-11-09T10:00:00.000Z');
    harness.movedTo(opening);
    await deliveredAll(
      harness.assessor,
      finished({ id: 'mon', workflow: 'check', at: opening, data: { output: { failed: 0 } } }),
    );
    const performs = await harness.performedAt(opening);

    expect(performs).toBe(1);
    expect(await harness.row(assessmentsName, experimentId('MAR-41'))).toMatchObject({ outcome: 'goal_retired' });
    expect(await harness.row(assessmentsName, dayOf('2026-11-09'))).toMatchObject({ verdict: 'open' });
    expect(await harness.row(clocksName, clockKey, 'paying-customers')).toMatchObject({ opens_at: null });
    expect(await harness.row(clocksName, clockKey, 'controls-hold')).toMatchObject({
      opens_at: Date.parse('2026-11-10T00:00:00.000Z'),
    });
  });
});

describe('a retired playbook whose retired goal left assessments open', () => {
  it('keeps them, is woken once a day, and ends them in the first wake after its restore', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.book.workflowSaved('measure', 1, measuring);
    await harness.goalsSaved([experiments], '2026-11-08T12:00:00.000Z');
    await harness.observed('r1', results(0).output, '2026-11-09T09:00:00.000Z', 'measure');

    harness.statusIs('retired');
    await harness.goalsSaved([{ ...experiments, retired: true }], '2026-11-10T09:00:00.000Z');
    await harness.steppedTo('2026-11-12T12:00:00.000Z');
    const whileRetired = await harness.row(assessmentsName, experimentId('MAR-41'));
    harness.statusIs('active');
    await harness.steppedTo('2026-11-14T12:00:00.000Z');

    expect(whileRetired).toMatchObject({ outcome: null, open: true });
    expect(await harness.row(assessmentsName, experimentId('MAR-41'))).toMatchObject({ outcome: 'goal_retired' });
    expect(await harness.row(clocksName, clockKey)).toMatchObject({ opens_at: null });
    expect(stamps(harness)).toEqual([
      '2026-11-10T09:00:00.000Z 1',
      '2026-11-11T00:00:00.000Z 1',
      '2026-11-12T00:00:00.000Z 1',
      '2026-11-13T00:00:00.000Z 1',
    ]);
  });
});

describe('a retired playbook', () => {
  it('opens nothing, ends without a notice what falls due, and is woken at most once a day for a week', async () => {
    const harness = await monitored();

    harness.statusIs('retired');
    await harness.steppedTo('2026-11-16T12:00:00.000Z');

    expect(await harness.row(assessmentsName, dayOf('2026-11-09'))).toMatchObject({
      outcome: 'playbook_retired',
      notice_due_at: null,
      judging_due_at: null,
    });
    expect(Object.keys(await harness.book.rows(assessmentsName))).toEqual([dayOf('2026-11-09')]);
    expect(stamps(harness)).toEqual([
      '2026-11-09T00:00:00.000Z 1',
      '2026-11-10T00:00:00.000Z 1',
      '2026-11-11T00:00:00.000Z 2',
      '2026-11-12T00:00:00.000Z 1',
      '2026-11-13T00:00:00.000Z 1',
      '2026-11-14T00:00:00.000Z 1',
      '2026-11-15T00:00:00.000Z 1',
      '2026-11-16T00:00:00.000Z 1',
    ]);
  });

  it('resumes within a day of its restore, opening only the current window', async () => {
    const harness = await monitored();
    harness.statusIs('retired');
    await harness.steppedTo('2026-11-12T12:00:00.000Z');

    harness.statusIs('active');
    await harness.steppedTo('2026-11-13T00:00:00.000Z');

    expect(Object.keys(await harness.book.rows(assessmentsName)).toSorted()).toEqual(
      [dayOf('2026-11-09'), dayOf('2026-11-13')].toSorted(),
    );
    expect(await harness.row(clocksName, clockKey)).toMatchObject({ opens_at: Date.parse('2026-11-14T00:00:00.000Z') });
  });

  it('is one the registry does not know, which the clock treats as retired', async () => {
    const harness = await monitored();

    harness.statusIs('unknown');
    await harness.steppedTo('2026-11-11T12:00:00.000Z');

    expect(Object.keys(await harness.book.rows(assessmentsName))).toEqual([dayOf('2026-11-09')]);
    expect(await harness.row(clocksName, clockKey)).toMatchObject({ opens_at: Date.parse('2026-11-12T00:00:00.000Z') });
  });
});

describe('a retired playbook with many short windows', () => {
  it('holds their dues to one wake a day, ending each that fell due', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.book.workflowSaved('launch', 1, launching);
    await harness.goalsSaved([launches], '2026-11-08T12:00:00.000Z');
    const many = Array.from({ length: mostHeldInARead + 1 }, (_, index) => ({
      issue: `L-${String(index)}`,
      customers: 0,
    }));
    await harness.observed('first', results(0).output, '2026-11-09T09:00:00.000Z', 'launch');
    await harness.observed('many', { results: many }, '2026-11-09T09:30:00.000Z', 'launch');

    harness.statusIs('retired');
    await harness.steppedTo('2026-11-11T12:00:00.000Z');
    const outcomes = Object.values(await harness.book.rows(assessmentsName)).map((row) => row['outcome']);

    expect(outcomes).toHaveLength(mostHeldInARead + 2);
    expect(new Set(outcomes)).toEqual(new Set(['playbook_retired']));
    expect(stamps(harness)).toEqual([
      '2026-11-09T10:01:00.000Z 1',
      `2026-11-10T00:00:00.000Z ${String(mostHeldInARead + 1)}`,
    ]);
  });
});

describe('a rebuilt table', () => {
  it('holds every due the folds set, so the clock goes on from it as it would have', async () => {
    const harness = await monitored();
    await harness.observed('mon', { failed: 0 }, '2026-11-09T13:00:00.000Z');
    await harness.steppedTo('2026-11-10T06:00:00.000Z');

    const rebuilt = await harness.rebuilt();
    const performedAfterRebuild = await rebuilt.performedAt(rebuilt.now());

    expect(performedAfterRebuild).toBe(0);
    expect(await duesOf(rebuilt)).toEqual(await duesOf(harness));
    await harness.steppedTo('2026-11-12T06:00:00.000Z');
    await rebuilt.steppedTo('2026-11-12T06:00:00.000Z');
    expect(await rebuilt.book.rows(assessmentsName)).toEqual(await harness.book.rows(assessmentsName));
    expect(stamps(rebuilt)).toEqual(stamps(harness).slice(-4));
  });
});
