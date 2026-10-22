import {
  publishedOutputOf,
  seriesShape,
  type CalledDefinition,
  type CallRole,
  type DefinitionSummary,
  type SavedDefinitions,
  type StrippedForms,
} from '@on.auto/definitions';
import { issueText, type DocumentIssue } from '@on.auto/definitions/document';
import { InvalidInput, type Unavailable } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { dataJsonOf } from '../data/data-digest.ts';
import { parsePredictionDocument } from '../document/document-parsing.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';

export type PredictionCheck = (
  document: PredictionFunctionDefinitionDocument,
  source: string,
  saved: SavedDefinitions,
) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;

export function invalidDefinition(issues: readonly DocumentIssue[]): InvalidInput {
  return new InvalidInput({
    detail: `The prediction function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
    issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
  });
}

export function parse(source: string): Effect.Effect<PredictionFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parsePredictionDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) => Effect.fail(invalidDefinition(issues)),
  });
}

type DatasetDetails = { readonly data_sha256: string; readonly data: Schema.JsonObject };

export function datasetDetailsOf({ data, dataSha256, predicts }: PredictionFunctionDefinitionDocument): DatasetDetails {
  return { data_sha256: dataSha256, data: dataJsonOf(data, predicts.period) };
}

function interactionCalled(name: string | undefined, role: CallRole): readonly CalledDefinition[] {
  return name === undefined ? [] : [{ type: 'interaction', name, role }];
}

function callsOf({ source, evaluation: { activate } }: PredictionFunctionDefinitionDocument) {
  return [
    ...interactionCalled(source.through, 'trainer'),
    ...interactionCalled(activate === 'automatic' ? undefined : activate.approved, 'approver'),
  ];
}

export function summarize(document: PredictionFunctionDefinitionDocument): DefinitionSummary {
  const { description, schemas } = document;
  const calls = callsOf(document);
  return {
    ...(description === undefined ? {} : { description }),
    inputSchema: schemas.input,
    ...publishedOutputOf({
      shape: seriesShape,
      details: { ...datasetDetailsOf(document), ...(calls.length === 0 ? {} : { calls }) },
    }),
  };
}
