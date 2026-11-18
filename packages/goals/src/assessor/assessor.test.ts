import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import {
  built,
  byHand,
  calledBy,
  experimentId,
  lacking,
  measuring,
  noReads,
  results,
  startedAs,
} from './assessor-fixtures.ts';
import {
  bookOf,
  deliveredAll,
  delivering,
  experiments,
  finished,
  monday,
  onSchedule,
  salesKey,
} from './assessor-ledger.ts';
import { assessorName, assessorOf } from './assessor.ts';
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
  it('are none for a run of a workflow whose name the playbook does not hold', async () => {
    const { ports } = await built();
    const assessor = assessorOf(ports);

    const unheld = await deliveredAll(assessor, finished({ id: 'u', workflow: 'unsaved', data: results(0) }));

    expect(unheld.keys).toEqual([]);
  });

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

describe('the playbooks the assessor wants', () => {
  it('are those whose goals were saved, answered from their clock row', async () => {
    const book = bookOf();
    const assessor = assessorOf({ ...(await built()).ports, ledger: book.ledger });
    const wants = (key: string) => Effect.runPromise(assessor.wants(key));

    const before = await wants(salesKey);
    await book.goalsSaved([experiments]);

    expect({ name: assessor.name, types: assessor.types, sweeps: assessor.skippedAfterSweeps }).toEqual({
      name: assessorName,
      types: ['run_succeeded', 'run_failed', 'run_rejected'],
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

describe('a run a person began by hand', () => {
  it('counts as a scheduled run does, and opens and observes the assessments it touches', async () => {
    const hand = finished({ id: 'hand', data: results(0, 1), context: byHand });
    const { book, ports } = await built(startedAs(hand));

    const delivered = await deliveredAll(assessorOf(ports), hand);
    const rows = await book.rows(assessmentsName);

    expect(delivered.keys).toEqual([`a:${experimentId('MAR-41')}`, `a:${experimentId('MAR-42')}`].toSorted());
    expect(rows[experimentId('MAR-42')]).toMatchObject({ per_id: 'MAR-42', verdict: 'passed' });
  });

  it('is delivered again later when who began it cannot be read, and opens nothing meanwhile', async () => {
    const { book, ports } = await built();

    const delivered = await deliveredAll(
      assessorOf(ports),
      finished({ id: 'hand', data: results(1), context: byHand }),
    );

    expect(delivered).toMatchObject({ keys: [], failed: ['!'] });
    expect(Object.keys(await book.rows(assessmentsName))).toEqual([]);
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
  it('observes nothing when it is no workflow, or it did not succeed', async () => {
    const { book, ports } = await built();
    const assessor = assessorOf(ports);
    const records = [
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

  it('observes nothing when it was started as a test, and nothing for a run it called', async () => {
    const tried = finished({ id: 'tried', data: results(1), context: { ...byHand, test: true } });
    const child = finished({ id: 'child', data: results(1), context: byHand });
    const { book, ports } = await built(startedAs(tried, calledBy(child, 'run-tried')));
    const assessor = assessorOf(ports);

    const delivered = await Promise.all(
      [tried, calledBy(child, 'run-tried')].map((record) => deliveredAll(assessor, record)),
    );

    expect(delivered.map(({ keys, failed }) => [keys, failed])).toEqual([
      [[], []],
      [[], []],
    ]);
    expect(Object.keys(await book.rows(assessmentsName))).toEqual([]);
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
