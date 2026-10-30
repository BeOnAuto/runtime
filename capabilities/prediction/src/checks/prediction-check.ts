import { noStrippedForms, type StrippedForms } from '@on.auto/definitions';
import { checkedAtSave, type CheckedDocument } from '@on.auto/definitions/check';
import { reportedIssues, type DocumentIssue } from '@on.auto/definitions/document';
import type { InvalidInput, Unavailable } from '@on.auto/operations';
import type { CheckIssue, ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import { invalidDefinition } from '../capability/prediction-definitions.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';

const dataNames = ['$data'];

const nothingToCheck: CheckedDocument = { stripped: noStrippedForms };

function expressionsChecked(pool: ProgramPool, { dataExpressions }: PredictionFunctionDefinitionDocument) {
  return dataExpressions.length === 0
    ? Effect.succeed(nothingToCheck)
    : checkedAtSave(pool, {
        schemas: {},
        expressions: dataExpressions.map(({ source }) => ({ source, names: dataNames })),
      });
}

function placedIssues(
  { dataExpressions }: PredictionFunctionDefinitionDocument,
  issues: readonly CheckIssue[],
): readonly DocumentIssue[] {
  return dataExpressions.flatMap(({ pointer, line: first }, index) =>
    issues.filter(({ at }) => at === index).map(({ line, detail }) => ({ line: first + line - 1, pointer, detail })),
  );
}

export function predictionCheck(
  pool: ProgramPool,
): (document: PredictionFunctionDefinitionDocument) => Effect.Effect<StrippedForms, InvalidInput | Unavailable> {
  return (document) =>
    Effect.flatMap(expressionsChecked(pool, document), (checked) =>
      'issues' in checked
        ? Effect.fail(invalidDefinition(reportedIssues(placedIssues(document, checked.issues))))
        : Effect.succeed(checked.stripped),
    );
}
