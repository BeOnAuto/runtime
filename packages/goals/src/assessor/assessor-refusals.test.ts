import { DatabaseFailed } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ChainFact } from '../chain-origins/chain-origin.ts';
import type { ChainReads } from '../chain-origins/chain-origins.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { refusalsName } from '../goal-tables/refusal-rows.ts';
import { built, calledBy, experimentId, measuring, noReads, results } from './assessor-fixtures.ts';
import { deliveredAll, finished, monday, onSchedule, salesKey } from './assessor-ledger.ts';
import { assessorOf } from './assessor.ts';

const refusedKey = 'r:paying-customers.measure';

const away = () => Effect.fail(new DatabaseFailed({ detail: 'The ledger is away' }));

const top: ChainFact = {
  stream: `${salesKey}runs/top`,
  context: { at: new Date(monday).toISOString(), by: 'playbook:sales', ...onSchedule },
  causationId: null,
  correlationId: 'top',
};

const scheduledAbove: ChainReads<never> = {
  firstFactOf: (run) => Effect.succeed(new Map([['top', top]]).get(run)),
  recordOf: () => Effect.succeed(new Map<string, ChainFact>().get('none')),
};

describe('bad data in a run', () => {
  it('is a refused observation, recorded when its detail changes and otherwise once a UTC day by the ends of the runs, and never a failure', async () => {
    const clock = { now: monday + 60_000 };
    const { book, ports } = await built(noReads, () => clock.now);
    const assessor = assessorOf(ports);

    const gone = await deliveredAll(assessor, finished({ id: 'g1', data: null }));
    const sameRun = await deliveredAll(assessorOf(ports), finished({ id: 'g1', data: null }));
    const within = await deliveredAll(assessor, finished({ id: 'g2', run: 'two', data: { output: { results: 3 } } }));
    clock.now += 61_000;
    const later = await deliveredAll(
      assessor,
      finished({ id: 'g3', run: 'three', at: monday + 61_000, data: { output: { results: 3 } } }),
    );

    expect([gone, sameRun, within, later].map(({ keys, failed }) => ({ keys, failed }))).toEqual(
      [gone, sameRun, within, later].map(() => ({ keys: [refusedKey], failed: [] })),
    );
    expect(await book.factsOf('goal-refusals/paying-customers.measure')).toEqual([
      'goal_observation_refused',
      'goal_observation_refused',
    ]);
    expect((await book.rows(refusalsName))['paying-customers.measure']).toMatchObject({
      run: 'two',
      detail: '/contributes/0: each at /results is not a list',
      refusals: 2,
    });
  });

  it('is a refused observation where a condition cannot be evaluated, and nothing where it is false', async () => {
    const { book, ports } = await built();
    await book.workflowSaved('measure', 2, [
      { ...measuring[0], when: '${ $data.customers.missing.deeper }' },
      { goal: 'controls-hold', purpose: 'Checks every control.', measures: '/failed', when: '${ false }' },
    ]);
    const output = { output: { ...results(1, 2).output, failed: 1 } };

    const delivered = await deliveredAll(assessorOf(ports), finished({ id: 'w1', version: 2, data: output }));

    expect(delivered.keys).toEqual([refusedKey]);
    expect(Object.values(await book.rows(refusalsName))[0]?.['detail']).toMatch(
      /^\/contributes\/0, item 0: the condition cannot be evaluated/u,
    );
  });
});

describe('a ledger that cannot be read or written now', () => {
  it('fails the delivery of a run whose chain cannot be read, and plans it again when it is retried', async () => {
    const failing: ChainReads<DatabaseFailed> = { firstFactOf: away, recordOf: away };
    const { ports } = await built(failing);
    const assessor = assessorOf(ports);
    const record = calledBy(finished({ id: 'child', data: results(1), context: { by: 'playbook:sales' } }), 'top');

    const tries = [await deliveredAll(assessor, record), await deliveredAll(assessor, record)];

    expect(tries).toEqual([0, 1].map(() => ({ keys: [], failed: ['!'], batches: 1 })));
    expect(assessor.spent().plans).toBe(2);
  });

  it('fails a delivery it cannot write, so it is tried again', async () => {
    const { ports } = await built();
    const ledger = { ...ports.ledger, execute: () => Effect.die(new Error('The ledger is away')) };
    const assessor = assessorOf({ ...ports, ledger });

    const delivered = await deliveredAll(assessor, finished({ id: 'r1', data: results(1) }));
    const refused = await deliveredAll(assessor, finished({ id: 'r2', data: null }));

    expect([delivered.failed, refused.failed]).toEqual([[`a:${experimentId('MAR-41')}`], [refusedKey]]);
  });
});

describe('a run another run called', () => {
  it('counts when the run that called it began on a schedule', async () => {
    const { book, ports } = await built(scheduledAbove);
    const child = calledBy(finished({ id: 'child', data: results(1), context: { by: 'playbook:sales' } }), 'top');

    const delivered = await deliveredAll(assessorOf(ports), child);

    expect(delivered.keys).toEqual([`a:${experimentId('MAR-41')}`]);
    expect(Object.keys(await book.rows(assessmentsName))).toEqual([experimentId('MAR-41')]);
  });
});

describe('a run whose observation was refused, delivered again', () => {
  it('is recorded once for a run, also when its run and one it held back are delivered again after a later run', async () => {
    const clock = { now: monday + 1000 };
    const { book, ports } = await built(noReads, () => clock.now);
    await deliveredAll(assessorOf(ports), finished({ id: 'g1', data: null }));
    clock.now = monday + 31_000;
    await deliveredAll(assessorOf(ports), finished({ id: 'g2', run: 'two', at: monday + 30_000, data: null }));
    clock.now = monday + 62_000;
    await deliveredAll(assessorOf(ports), finished({ id: 'g3', run: 'three', at: monday + 61_000, data: null }));
    clock.now += 600_000;

    const again = await Promise.all(
      [finished({ id: 'g1', data: null }), finished({ id: 'g2', run: 'two', at: monday + 30_000, data: null })].map(
        (record) => deliveredAll(assessorOf(ports), record),
      ),
    );

    expect(again.map(({ failed }) => failed)).toEqual([[], []]);
    expect(await book.factsOf('goal-refusals/paying-customers.measure')).toEqual(['goal_observation_refused']);
  });
});

const minute = 60_000;

describe('a workflow refused every minute for ten hours', () => {
  it('adds one fact for the same detail, one more at once when the detail changes, and one on the next UTC day', async () => {
    const clock = { now: monday };
    const { book, ports } = await built(noReads, () => clock.now);
    const assessor = assessorOf(ports);
    const refusedAt = (index: number, data: unknown) => {
      clock.now = monday + index * minute;
      return deliveredAll(
        assessor,
        finished({ id: `m${String(index)}`, run: `run-${String(index)}`, at: clock.now, data }),
      );
    };
    const factsNow = async () => (await book.factsOf('goal-refusals/paying-customers.measure')).length;

    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 600 }, (_, index) => index),
        (index) => Effect.promise(() => refusedAt(index, null)),
      ),
    );
    const sameDetail = await factsNow();
    await refusedAt(600, { output: { results: 3 } });
    const changed = await factsNow();
    await refusedAt(601, { output: { results: 3 } });
    await refusedAt(24 * 60, { output: { results: 3 } });

    expect([sameDetail, changed, await factsNow()]).toEqual([1, 2, 3]);
  });
});

describe('a refusal after a counted run of the same workflow', () => {
  it('records it again once a counted run of the workflow came between, so its gap shows again', async () => {
    const clock = { now: monday };
    const { book, ports } = await built(noReads, () => clock.now);
    const assessor = assessorOf(ports);
    await deliveredAll(assessor, finished({ id: 'n1', run: 'one', at: monday, data: null }));
    clock.now = monday + 2 * minute;
    await deliveredAll(assessor, finished({ id: 'n2', run: 'two', at: clock.now, data: results(1) }));
    clock.now = monday + 4 * minute;
    await deliveredAll(assessor, finished({ id: 'n3', run: 'three', at: clock.now, data: null }));
    clock.now = monday + 5 * minute;
    await deliveredAll(assessor, finished({ id: 'n4', run: 'four', at: clock.now, data: null }));

    expect(await book.factsOf('goal-refusals/paying-customers.measure')).toEqual([
      'goal_observation_refused',
      'goal_observation_refused',
    ]);
    expect((await book.rows(refusalsName))['paying-customers.measure']).toMatchObject({
      run: 'three',
      at: monday + 4 * minute,
    });
  });
});
