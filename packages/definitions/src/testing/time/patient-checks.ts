import type { ProgramPool } from '@on.auto/workflow-engine/dsl';

export const checksAwaitedAtMostMs = 30_000;

export function checkingWithin(pool: ProgramPool, deadlineMs = checksAwaitedAtMostMs): ProgramPool {
  return { ...pool, check: (request, signal) => pool.check({ ...request, deadlineMs }, signal) };
}
