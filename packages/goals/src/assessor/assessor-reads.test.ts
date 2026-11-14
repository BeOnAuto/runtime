import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { built, experimentId, measuring, noReads, results } from './assessor-fixtures.ts';
import { delivering, deliveredAll, finished, monday } from './assessor-ledger.ts';
import { assessorOf } from './assessor.ts';
import { mostVersionsKept } from './contributed-versions.ts';
import { mostPlansKept } from './run-planner.ts';

describe('what the assessor keeps between records', () => {
  it('is the contributes of its latest versions and the plans of its latest records', async () => {
    const { ports } = await built();
    const assessor = assessorOf(ports);
    const versions = Array.from({ length: mostVersionsKept + 1 }, (_, index) => index + 2);
    const records = [
      ...versions.map((version) => finished({ id: `v${String(version)}`, version })),
      finished({ id: 'again', version: 2 }),
      ...Array.from({ length: mostPlansKept + 1 }, (_, index) => finished({ id: `p${String(index)}` })),
      finished({ id: 'p0' }),
    ];

    await Effect.runPromise(Effect.forEach(records, (record) => delivering(assessor, record)));

    expect(assessor.spent()).toMatchObject({
      versionReads: versions.length + 2,
      plans: versions.length + 1 + mostPlansKept + 2,
    });
  });
});

describe('the entries the assessor reads', () => {
  it('leave out goals the playbook does not have, and observe nothing when none is left', async () => {
    const { book, ports } = await built();
    const gone = { goal: 'gone-goal', purpose: 'Counts what is gone.', measures: '/n' };
    await book.workflowSaved('measure', 2, [gone, ...measuring]);
    await book.workflowSaved('orphan', 1, [gone]);
    const assessor = assessorOf(ports);

    const kept = await deliveredAll(assessor, finished({ id: 'm', version: 2, data: results(0) }));
    const orphaned = await deliveredAll(
      assessor,
      finished({ id: 'o', workflow: 'orphan', data: { output: { n: 1 } } }),
    );

    expect(kept.keys).toEqual([`a:${experimentId('MAR-41')}`]);
    expect(orphaned.keys).toEqual([]);
  });

  it('open the calendar window that holds the run end, and judge it at once when delivered past its due', async () => {
    const daily = [{ goal: 'controls-hold', purpose: 'Checks every control.', measures: '/failed', final: '/all' }];
    const today = await built(noReads, () => monday + 60_000);
    await today.book.workflowSaved('check', 1, daily);
    const tomorrow = await built(noReads, () => monday + 86_400_000);
    await tomorrow.book.workflowSaved('check', 1, daily);
    const run = finished({ id: 'c1', workflow: 'check', data: { output: { failed: 0, all: true } } });

    await deliveredAll(assessorOf(today.ports), run);
    await deliveredAll(assessorOf(tomorrow.ports), run);
    const window = assessmentIdOf({ goal: 'controls-hold', window_start: Date.parse('2026-11-09T00:00:00.000Z') });

    expect(await today.book.factsOf(`assessments/${window}`)).toEqual(['goal_assessment_opened', 'goal_observed']);
    expect(await tomorrow.book.factsOf(`assessments/${window}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_assessed',
    ]);
  });
});
