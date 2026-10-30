import type { PoolOutcome, ProgramPool } from '../jobs/pool-contract.ts';

export function scriptedPool(script: readonly PoolOutcome[], otherwise: ProgramPool): ProgramPool {
  const remaining = [...script];
  return {
    workers: otherwise.workers,
    heapMegabytes: otherwise.heapMegabytes,
    run: (request, signal) => {
      const [next] = remaining.splice(0, 1);
      return next === undefined ? otherwise.run(request, signal) : Promise.resolve(next);
    },
    fold: otherwise.fold,
    check: otherwise.check,
    evaluations: otherwise.evaluations,
    close: otherwise.close,
  };
}
