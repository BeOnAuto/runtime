import { computationBounds } from '@on.auto/computation';
import { checkingWithin, measuredPoolSettings } from '@on.auto/definitions/testing';
import { programPool, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import { onTestFinished } from 'vitest';

export function runtimePool(): ProgramPool {
  const pool = programPool({ workers: 1, heapMegabytes: computationBounds.heapMegabytes, ...measuredPoolSettings });
  onTestFinished(() => pool.close());
  return checkingWithin(pool);
}
