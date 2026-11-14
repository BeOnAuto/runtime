import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { experimentId, measuring, results } from '../assessor/assessor-fixtures.ts';
import { controls, deliveredAll, experiments, finished, sales } from '../assessor/assessor-ledger.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clockKey, clocksName } from '../goal-tables/clock-rows.ts';
import { clockHarnessOf } from './clock-harness.ts';
import { goalsClockName } from './goals-clock.ts';

const checking = [{ goal: 'controls-hold', purpose: 'Checks every control each morning.', measures: '/failed' }];

const mondayId = assessmentIdOf({ goal: 'controls-hold', window_start: Date.parse('2026-11-09T00:00:00.000Z') });

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe('the clock of a playbook with no goals', () => {
  it('has nothing due and no next due, so it is never woken', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');

    expect(harness.clock.name).toBe(goalsClockName);
    expect(await run(harness.clock.due(Date.parse('2030-01-01T00:00:00.000Z'), 256, false))).toEqual([]);
    expect(await run(harness.clock.nextDueAt(0))).toBeNull();
    expect(await run(harness.clock.nextDueAt(0, false))).toBeNull();
  });
});

describe('the clock of goals with no calendar window', () => {
  it('is woken once at the save, and never after, while no assessment has a due', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.book.workflowSaved('measure', 1, measuring);

    await harness.goalsSaved([experiments], '2026-11-08T12:00:00.000Z');
    await harness.observed('r1', results(0).output, '2026-11-09T09:00:00.000Z', 'measure');
    await harness.until('2027-11-08T00:00:00.000Z');

    expect(await harness.row(clocksName, clockKey)).toMatchObject({ opens_at: null });
    expect(await harness.row(assessmentsName, experimentId('MAR-41'))).toMatchObject({ judging_due_at: null });
    expect(await run(harness.clock.nextDueAt(0))).toBeNull();
    expect(harness.wakes).toEqual([]);
  });
});

describe('the clock of a calendar goal', () => {
  it('calls out for nothing, so the work of the calls has nothing of it', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.book.workflowSaved('check', 1, checking);
    await harness.goalsSaved([controls], '2026-11-08T12:00:00.000Z');
    const at = Date.parse('2026-11-09T00:00:00.000Z');

    expect(await run(harness.clock.nextDueAt(0))).toBe(at);
    expect((await run(harness.clock.due(at, 256, false))).map(({ key, callsOut }) => [key, callsOut])).toEqual([
      [`${sales.org}/${sales.playbook}/${clocksName}/${clockKey}`, false],
    ]);
    expect(await run(harness.clock.due(at, 256, true))).toEqual([]);
    expect(await run(harness.clock.nextDueAt(0, true))).toBeNull();
  });

  it('hands out no more rows than it is asked for, the clock rows first', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.book.workflowSaved('check', 1, checking);
    await harness.goalsSaved([controls], '2026-11-08T12:00:00.000Z');
    await harness.until('2026-11-09T00:00:00.000Z');
    const later = Date.parse('2026-11-12T00:00:00.000Z');

    expect((await run(harness.clock.due(later, 1, false))).map(({ key }) => key)).toEqual([
      `${sales.org}/${sales.playbook}/${clocksName}/${clockKey}`,
    ]);
    expect((await run(harness.clock.due(later, 2, false))).map(({ key }) => key)).toEqual([
      `${sales.org}/${sales.playbook}/${clocksName}/${clockKey}`,
      `${sales.org}/${sales.playbook}/${assessmentsName}/${mondayId}`,
    ]);
  });
});

describe('a due row of a calendar goal with nothing to do', () => {
  it('moves past the present: to its due when it was early, to none when it is decided', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.book.workflowSaved('check', 1, checking);
    await harness.goalsSaved([controls], '2026-11-08T12:00:00.000Z');
    await harness.until('2026-11-09T00:00:00.000Z');
    const early = Date.parse('2026-11-09T06:00:00.000Z');
    const advanced = (judging: number) =>
      run(
        harness.book.ledger.advanceRow(assessmentsName, sales, mondayId, {
          set: { judging_due_at: judging },
          when: [],
        }),
      );

    await advanced(early);
    const performedEarly = await harness.performedAt(early);
    const movedToDue = await harness.row(assessmentsName, mondayId);
    await harness.observed('mon', { failed: 1 }, '2026-11-09T09:00:00.000Z');
    await advanced(Date.parse('2026-11-09T09:30:00.000Z'));
    const performedDecided = await harness.performedAt(Date.parse('2026-11-09T10:00:00.000Z'));

    expect([performedEarly, performedDecided]).toEqual([1, 1]);
    expect(movedToDue).toMatchObject({ judging_due_at: Date.parse('2026-11-10T01:00:00.000Z'), verdict: 'open' });
    expect(await harness.row(assessmentsName, mondayId)).toMatchObject({ judging_due_at: null, verdict: 'failed' });
    expect(await harness.book.factsOf(`assessments/${mondayId}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_assessed',
    ]);
  });
});

describe('a clock row read before an observation opened its window', () => {
  it('opens nothing an observation opened after its row was read, and moves its row to the next opening', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
    await harness.book.workflowSaved('check', 1, checking);
    await harness.goalsSaved([controls], '2026-11-08T12:00:00.000Z');
    const at = Date.parse('2026-11-09T00:00:00.000Z');
    const items = await run(harness.clock.due(at, 256, false));

    harness.movedTo(at + 30_000);
    await deliveredAll(
      harness.assessor,
      finished({ id: 'mon', workflow: 'check', at: at + 30_000, data: { output: { failed: 0 } } }),
    );
    await run(Effect.forEach(items, (item) => item.perform(at + 30_000)));

    expect(await harness.book.factsOf(`assessments/${mondayId}`)).toEqual(['goal_assessment_opened', 'goal_observed']);
    expect(await harness.row(clocksName, clockKey)).toMatchObject({ opens_at: Date.parse('2026-11-10T00:00:00.000Z') });
    expect(await run(harness.clock.due(at + 30_000, 256, false))).toEqual([]);
  });
});

const tuesdayId = assessmentIdOf({ goal: 'controls-hold', window_start: Date.parse('2026-11-11T00:00:00.000Z') });

async function resumedMidDay() {
  const harness = clockHarnessOf('2026-11-08T07:00:00.000Z');
  await harness.book.workflowSaved('check', 1, checking);
  await harness.paused('check', '2026-11-08T08:00:00.000Z');
  await harness.goalsSaved([controls], '2026-11-08T12:00:00.000Z');
  await harness.until('2026-11-11T10:00:00.000Z');
  const whilePaused = harness.wakes.map(({ at }) => new Date(at).toISOString());
  const quiet = await harness.row(clocksName, clockKey);
  await harness.book.append(
    'definitions/workflow',
    'definition_resumed',
    {},
    { at: '2026-11-11T10:00:00.000Z', definitionType: 'workflow', definitionName: 'check', definitionVersion: 1 },
  );
  return { harness, whilePaused, quiet };
}

describe('the clock of a calendar goal whose only contribution is paused', () => {
  it('is woken once at the boundary after the save and not again while paused, and a resume arms it for the next window', async () => {
    const { harness, whilePaused, quiet } = await resumedMidDay();
    const armed = await harness.row(clocksName, clockKey);
    await harness.until('2026-11-13T02:00:00.000Z');
    const resumed = harness.wakes.slice(whilePaused.length).map(({ at }) => new Date(at).toISOString());
    const rows = await harness.book.rows(assessmentsName);

    expect(whilePaused).toEqual(['2026-11-09T00:00:00.000Z']);
    expect(quiet).toMatchObject({ opens_at: null });
    expect(armed).toMatchObject({ opens_at: Date.parse('2026-11-12T00:00:00.000Z') });
    expect(resumed).toEqual(['2026-11-12T00:00:00.000Z', '2026-11-13T00:00:00.000Z', '2026-11-13T01:00:00.000Z']);
    expect(
      Object.values(rows)
        .map((row) => Number(row['window_opens']))
        .toSorted((one, other) => one - other),
    ).toEqual([Date.parse('2026-11-12T00:00:00.000Z'), Date.parse('2026-11-13T00:00:00.000Z')]);
    expect(await harness.book.factsOf(`assessments/${tuesdayId}`)).toEqual([]);
  });

  it('opens the window it was resumed in only by a run that falls in it', async () => {
    const { harness } = await resumedMidDay();
    await harness.observed('t1', { failed: 1 }, '2026-11-11T11:00:00.000Z', 'check');
    await harness.until('2026-11-12T02:00:00.000Z');

    expect(await harness.book.factsOf(`assessments/${tuesdayId}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_assessed',
    ]);
  });
});
