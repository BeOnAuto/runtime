import { checkingWithin, measuredPoolSettings } from '@on.auto/definitions/testing';
import { programPool, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import { decidingWithin, scriptedPool, type PoolOutcome } from '@on.auto/workflow-engine/testing';
import { afterAll } from 'vitest';

import { workerPool, type ProgramPoolOf } from '../../composition/served-computation.ts';

const inputsAwaitedAtMostMs = 30_000;

function decidingPatiently(pool: ProgramPool): ProgramPool {
  const { machine } = pool.evaluations;
  return { ...pool, evaluations: { ...pool.evaluations, machine: decidingWithin(machine, inputsAwaitedAtMostMs) } };
}

export const patientWorkerPool: ProgramPoolOf = (settings, handed) =>
  decidingPatiently(checkingWithin(workerPool(settings, handed)));

export function scriptedWorkerPool(...outcomes: readonly PoolOutcome[]): ProgramPoolOf {
  return (settings, handed) => scriptedPool(outcomes, patientWorkerPool(settings, handed));
}

export function sharedWorkerPool(): ProgramPool {
  const pool = programPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });
  afterAll(() => pool.close());
  return pool;
}
