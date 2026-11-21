import { checkedAtSave } from '@on.auto/definitions/check';
import { checksAwaitedAtMostMs, measuredPoolSettings } from '@on.auto/definitions/testing';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { threadPool } from '@on.auto/workflow-engine/thread-pool';
import { afterAll } from 'vitest';

import type { ExpressionCheck } from '../document/expression-check.ts';

let pool: ProgramPool | undefined;

afterAll(async () => {
  await pool?.close();
  pool = undefined;
});

export const testExpressionCheck: ExpressionCheck = (job) => {
  pool ??= threadPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });
  return checkedAtSave(pool, job, checksAwaitedAtMostMs);
};
