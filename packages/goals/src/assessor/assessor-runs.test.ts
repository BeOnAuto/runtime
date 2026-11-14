import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { built, byHand, experimentId, lacking, measuring, results } from './assessor-fixtures.ts';
import { bookOf, deliveredAll, experiments, finished, onSchedule, salesKey } from './assessor-ledger.ts';
import { assessorName, assessorOf } from './assessor.ts';

describe('the playbooks the assessor wants', () => {
  it('are those whose goals were saved, answered from their clock row', async () => {
    const book = bookOf();
    const assessor = assessorOf({ ...(await built()).ports, ledger: book.ledger });
    const wants = (key: string) => Effect.runPromise(assessor.wants(key));

    const before = await wants(salesKey);
    await book.goalsSaved([experiments]);

    expect({ name: assessor.name, types: assessor.types, sweeps: assessor.skippedAfterSweeps }).toEqual({
      name: assessorName,
      types: ['run_succeeded'],
      sweeps: 20,
    });
    expect([before, await wants(salesKey), await wants('org/acme/')]).toEqual([false, true, false]);
  });
});

describe('a scheduled run of a contributing workflow', () => {
  it('makes one delivery for each assessment it touches, which opens and observes it', async () => {
    const { book, ports } = await built();
    const assessor = assessorOf(ports);

    const delivered = await deliveredAll(assessor, finished({ id: 'r1', data: results(0, 1) }));
    const rows = await book.rows(assessmentsName);

    expect(delivered).toEqual({
      keys: [`a:${experimentId('MAR-41')}`, `a:${experimentId('MAR-42')}`].toSorted(),
      failed: [],
      batches: 1,
    });
    expect(rows[experimentId('MAR-41')]).toMatchObject({ goal: 'paying-customers', per_id: 'MAR-41', verdict: 'open' });
    expect(rows[experimentId('MAR-42')]).toMatchObject({ per_id: 'MAR-42', verdict: 'passed', goals_version: 1 });
    expect(await book.factsOf(`assessments/${experimentId('MAR-42')}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_assessed',
    ]);
    expect(assessor.spent()).toMatchObject({ plans: 1, versionReads: 1, conditions: { sessions: 0 } });
  });
});

describe('a run delivered twice, or in pages', () => {
  it('is applied once, and pages the assessments it touches when a batch cannot hold them', async () => {
    const { book, ports } = await built();
    const assessor = assessorOf(ports);
    const record = finished({ id: 'r1', data: results(0, 0, 0) });

    const paged = await deliveredAll(assessor, record, 2);
    const again = await deliveredAll(assessorOf(ports), record);

    expect(paged).toMatchObject({ batches: 2, failed: [] });
    expect([paged.keys.length, again.keys.length]).toEqual([3, 3]);
    expect(await book.factsOf(`assessments/${experimentId('MAR-43')}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
    ]);
    expect(assessor.spent().plans).toBe(1);
  });

  it('evaluates its conditions once, however many batches its assessments take', async () => {
    const { book, ports } = await built();
    await book.workflowSaved('measure', 2, [{ ...measuring[0], when: '${ $data.customers >= 0 }' }]);
    const assessor = assessorOf(ports);

    const delivered = await deliveredAll(assessor, finished({ id: 'r1', version: 2, data: results(0, 0, 0, 0) }), 1);

    expect(delivered).toMatchObject({ batches: 4, failed: [] });
    expect(assessor.spent()).toMatchObject({ plans: 1, conditions: { sessions: 1, evaluations: 4 } });
  });
});

describe('a run that does not count', () => {
  it('observes nothing when a person began it, it is no workflow, or it did not succeed', async () => {
    const { book, ports } = await built();
    const assessor = assessorOf(ports);
    const records = [
      finished({ id: 'hand', data: results(1), context: byHand }),
      finished({ id: 'failed', type: 'run_failed' }),
      finished({ id: 'function', context: { ...onSchedule, definitionType: 'reasoning' } }),
      lacking('unnamed', 'definitionName'),
      lacking('unversioned', 'definitionVersion'),
      lacking('no run', 'runId'),
      finished({ id: 'notice', data: results(1), context: { trigger: { kind: 'goal', reference: '/goals' } } }),
    ];

    const delivered = await Promise.all(records.map((record) => deliveredAll(assessor, record)));

    expect(delivered.map(({ keys }) => keys)).toEqual(records.map(() => []));
    expect(Object.keys(await book.rows(assessmentsName))).toEqual([]);
    expect(assessor.spent().versionReads).toBe(1);
  });

  it('reads a version without contributes once, and reads nothing more for it', async () => {
    const { book, ports } = await built();
    await book.workflowSaved('tidy', 1);
    const assessor = assessorOf(ports);

    await deliveredAll(assessor, finished({ id: 't1', workflow: 'tidy' }));
    await deliveredAll(assessor, finished({ id: 't2', workflow: 'tidy' }));

    expect(assessor.spent()).toMatchObject({ plans: 2, versionReads: 1 });
  });
});
