import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  testAskedOn,
} from '../pool-testing/evaluation-workers.ts';
import { testPoolSettings } from '../pool-testing/test-pools.ts';
import { threadsAlive } from '../pool-testing/threads-alive.ts';
import { fakePoolTimers } from '../pool-testing/waiting.ts';
import { answerGraceMs } from '../program-pool/evaluation-thread.ts';
import { programPool } from '../program-pool/program-pool.ts';
import { filterVerdictsOf } from './filter-verdicts.ts';

const churning = 'repeat(4194304)';

const pastTheDeadlineOfAFilterMs = mostFilterMs + answerGraceMs + 1;

const pools: ProgramPool[] = [];

function european(reference: string): typeof plainFilter {
  return { ...plainFilter, reference };
}

beforeEach(() => {
  fakePoolTimers();
});

afterEach(async () => {
  vi.useRealTimers();
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

    const { answer, ...replaced } = await replacementOf(churning, mostFilterMs, () =>
      filterVerdictsOf([churningFilter, plainFilter], closed, patientOnceReplaced, evaluatedAt),
    );

    expect(answer).toMatchObject([{ error: { status: 500, instance: '/churn' }, stopped: true }, true]);
    expect(JSON.stringify(answer)).toContain(
      `The program ran past its deadline: one filter may take ${mostFilterMs} ms`,
    );
    expect(replaced).toEqual({ replacedByTheDeadline: true, replacedBeforeTheDeadline: false });
  });

  it('leaves the main thread free while a plain filter and a churning one after it are matched, so the main thread goes on while the churning one runs', async () => {
    const { filters } = poolOf({ evaluationWorker: announcingEvaluations }).evaluations;
    await filterVerdictsOf([plainFilter], closed, filters, evaluatedAt);
    const order: string[] = [];
    const churnAsked = testAskedOn(churning);

    const matched = filterVerdictsOf([plainFilter, churningFilter], closed, filters, evaluatedAt).then((verdicts) => {
      order.push('verdicts');
      return verdicts;
    });
    await churnAsked;
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        order.push('the main thread');
        resolve();
      });
    });
    await vi.advanceTimersByTimeAsync(pastTheDeadlineOfAFilterMs);
    const verdicts = await matched;

    expect(order).toEqual(['the main thread', 'verdicts']);
    expect(verdicts).toMatchObject([true, { stopped: true }]);
  });
});

describe('the filter worker of a pool, matching groups at the same time', () => {
  it('prepares again on the fresh worker the groups prepared on the worker a churning filter ended, so groups matched at the same time still match', async () => {
    const { filters } = poolOf({ evaluationWorker: announcingEvaluations }).evaluations;
    const patient = filteringWithin(filters, 30_000);
    await filterVerdictsOf([plainFilter], closed, filters, evaluatedAt);
    const churnAsked = testAskedOn(churning);

    const matching = Promise.all([
      filterVerdictsOf([churningFilter], closed, filters, evaluatedAt),
      filterVerdictsOf([european('/first')], closed, patient, evaluatedAt),
      filterVerdictsOf([european('/second')], closed, patient, evaluatedAt),
      filterVerdictsOf([european('/third')], closed, patient, evaluatedAt),
    ]);
    await churnAsked;
    await vi.advanceTimersByTimeAsync(pastTheDeadlineOfAFilterMs);
    const verdicts = await matching;

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
