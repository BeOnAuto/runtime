import { noStrippedForms, type StrippedForms } from '@on.auto/definitions';
import type { CheckedDocument } from '@on.auto/definitions/check';
import type { InvalidInput, Unavailable } from '@on.auto/operations';
import { workflowExpressionsOf, type PlacedExpression } from '@on.auto/workflow-engine';
import type { CheckIssue, CheckJob } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import { invalidDocument, notRunnable, placeOf, type LocatedIssue, type ReadWorkflow } from './workflow-document.ts';

export type ExpressionCheck = (job: CheckJob) => Effect.Effect<CheckedDocument, InvalidInput | Unavailable>;

function locatedIssues(
  { locate }: ReadWorkflow,
  expressions: readonly PlacedExpression[],
  issues: readonly CheckIssue[],
): readonly LocatedIssue[] {
  return expressions.flatMap(({ pointer }, index) => {
    const { line, column } = locate(pointer);
    return issues
      .filter(({ at }) => at === index)
      .map(({ line: within, detail }) => ({
        position: { line: line + within - 1, column },
        detail: `${placeOf(pointer)}${detail}`,
      }));
  });
}

export function checkedExpressions(
  check: ExpressionCheck,
): (read: ReadWorkflow) => Effect.Effect<StrippedForms, InvalidInput | Unavailable> {
  return (read) => {
    const expressions = workflowExpressionsOf(read.document);
    if (expressions.length === 0) {
      return Effect.succeed(noStrippedForms);
    }
    const job = { schemas: {}, expressions: expressions.map(({ source, names }) => ({ source, names })) };
    return check(job).pipe(
      Effect.flatMap((checked) =>
        'stripped' in checked
          ? Effect.succeed(checked.stripped)
          : Effect.fail(invalidDocument(notRunnable, locatedIssues(read, expressions, checked.issues))),
      ),
    );
  };
}
