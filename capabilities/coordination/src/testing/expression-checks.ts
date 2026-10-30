import { checkedAtSave } from '@on.auto/definitions/check';
import { checksAwaitedAtMostMs, measuredPoolSettings } from '@on.auto/definitions/testing';
import { programPool, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import { afterAll } from 'vitest';

import type { ExpressionCheck } from '../document/expression-check.ts';

let pool: ProgramPool | undefined;

afterAll(async () => {
  await pool?.close();
  pool = undefined;
});

export const testExpressionCheck: ExpressionCheck = (job) => {
  pool ??= programPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });
  return checkedAtSave(pool, job, checksAwaitedAtMostMs);
};
