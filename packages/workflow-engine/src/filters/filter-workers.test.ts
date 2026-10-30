import { afterEach, describe, expect, it } from 'vitest';

import { mostFilterMs } from '../dsl/evaluation.ts';
import type { PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import {
  announcingEvaluations,
  churningFilter,
  closed,
  evaluatedAt,
  filteringWithin,
  filteringWithinOnceReplaced,
  plainFilter,
  replacementOf,
} from '../pool-testing/evaluation-workers.ts';
import { testPoolSettings } from '../pool-testing/test-pools.ts';
import { threadsAlive } from '../pool-testing/threads-alive.ts';
import { programPool } from '../program-pool/program-pool.ts';
import { filterVerdictsOf } from './filter-verdicts.ts';

const timerMs = 20;

const pools: ProgramPool[] = [];

function european(reference: string): typeof plainFilter {
  return { ...plainFilter, reference };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ ...testPoolSettings(1), ...settings });
  pools.push(pool);
  return pool;
}

describe('the filter worker of a pool, given native work that no checkpoint interrupts', () => {
  it('ends a trigger filter at its own deadline of 200 ms, stopped, and matches the filter after it on a fresh worker', async () => {
    const { filters } = poolOf({ evaluationWorker: announcingEvaluations }).evaluations;
    await filterVerdictsOf([plainFilter], closed, filters, evaluatedAt);
    const patientOnceReplaced = filteringWithinOnceReplaced(filters, 30_000);

    const { answer, ...replaced } = await replacementOf('test', mostFilterMs, () =>
      filterVerdictsOf([churningFilter, plainFilter], closed, patientOnceReplaced, evaluatedAt),
    );

    expect(answer).toMatchObject([{ error: { status: 500, instance: '/churn' }, stopped: true }, true]);
    expect(JSON.stringify(answer)).toContain(
      `The program ran past its deadline: one filter may take ${mostFilterMs} ms`,
    );
    expect(replaced).toEqual({ replacedByTheDeadline: true, replacedBeforeTheDeadline: false });
  });

  it("leaves the main thread free while a plain filter and a churning one after it are matched, so the main thread's timer fires on schedule", async () => {
    const { filters } = poolOf().evaluations;
    await filterVerdictsOf([plainFilter], closed, filters, evaluatedAt);
    const order: string[] = [];

    const fired = new Promise<void>((resolve) => {
      setTimeout(() => {
        order.push('timer');
        resolve();
      }, timerMs);
    });
    const matched = filterVerdictsOf([plainFilter, churningFilter], closed, filters, evaluatedAt).then((verdicts) => {
      order.push('verdicts');
      return verdicts;
    });
    await Promise.all([fired, matched]);

    expect(timerMs).toBeLessThan(mostFilterMs);
    expect(order).toEqual(['timer', 'verdicts']);
    expect(await matched).toMatchObject([true, { stopped: true }]);
  });
});

describe('the filter worker of a pool, matching groups at the same time', () => {
  it('prepares again on the fresh worker the groups prepared on the worker a churning filter ended, so groups matched at the same time still match', async () => {
    const { filters } = poolOf().evaluations;
    const patient = filteringWithin(filters, 30_000);
    await filterVerdictsOf([plainFilter], closed, filters, evaluatedAt);

    const verdicts = await Promise.all([
      filterVerdictsOf([churningFilter], closed, filters, evaluatedAt),
      filterVerdictsOf([european('/first')], closed, patient, evaluatedAt),
      filterVerdictsOf([european('/second')], closed, patient, evaluatedAt),
      filterVerdictsOf([european('/third')], closed, patient, evaluatedAt),
    ]);

    expect(verdicts).toMatchObject([[{ stopped: true }], [true], [true], [true]]);
  });
});

describe('the filter worker of a pool that closed', () => {
  it('starts no worker, and ends a filter at once, stopped', async () => {
    const pool = poolOf();
    await pool.close();
    const before = threadsAlive();

    const verdicts = await filterVerdictsOf([plainFilter], closed, pool.evaluations.filters, evaluatedAt);

    expect(verdicts).toMatchObject([{ error: { status: 500, instance: '/plain' }, stopped: true }]);
    expect(threadsAlive()).toBe(before);
  });
});
