import type { ShippedFiles } from '@on.auto/operations';

import { expressionUnitOf } from '../programs/expression-units.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { freshInstance } from './fresh-instances.ts';

const probing = { budget: Number.POSITIVE_INFINITY, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

export async function sandboxAnswers(
  shippedFiles: ShippedFiles,
  expressions: readonly string[],
): Promise<readonly string[]> {
  const instance = await freshInstance(shippedFiles, unitMemoryBytes);
  const unit = expressionUnitOf(() => instance, {
    stackBytes: threadStackBytes,
    mostAnswerBytes: unitMemoryBytes,
    clock: () => 0,
  });
  try {
    return expressions.map((expression) => {
      const run = unit.evaluate(expression, {}, probing);
      return run.ran === 'answered' ? run.text : `${run.ran}: ${run.issue.detail}`;
    });
  } finally {
    unit.close();
  }
}
