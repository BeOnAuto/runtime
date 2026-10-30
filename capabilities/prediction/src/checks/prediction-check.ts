import { noStrippedForms } from '@on.auto/definitions';
import { checkedAtSave, type CheckedDocument } from '@on.auto/definitions/check';
import { reportedIssues, type DocumentIssue } from '@on.auto/definitions/document';
import type { CheckIssue, ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import { briefIssuesOverTheLargestDataset } from '../brief/brief-dataset.ts';
import { invalidDefinition, type PredictionCheck } from '../capability/prediction-definitions.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { calledFunctionIssues } from './called-functions.ts';
import { uploadedDatasetIssues } from './uploaded-datasets.ts';

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

export function predictionCheck(pool: ProgramPool): PredictionCheck {
  return (document, _source, saved) =>
    Effect.gen(function* () {
      const found = [
        ...(yield* briefIssuesOverTheLargestDataset(document)),
        ...(yield* calledFunctionIssues(document, saved)),
        ...(yield* uploadedDatasetIssues(document, saved)),
      ];
      const checked = yield* expressionsChecked(pool, document);
      if ('issues' in checked) {
        return yield* Effect.fail(
          invalidDefinition(reportedIssues([...found, ...placedIssues(document, checked.issues)])),
        );
      }
      return found.length > 0 ? yield* Effect.fail(invalidDefinition(reportedIssues(found))) : checked.stripped;
    });
}
