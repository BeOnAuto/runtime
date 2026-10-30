import { publishedOutputOf, seriesShape, type DefinitionSummary } from '@on.auto/definitions';
import { issueText, type DocumentIssue } from '@on.auto/definitions/document';
import { InvalidInput } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { dataJsonOf } from '../data/data-digest.ts';
import { parsePredictionDocument } from '../document/document-parsing.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';

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

type WrittenDatasetDetails = { readonly data: Schema.JsonObject };

export function datasetDetailsOf({ data, predicts }: PredictionFunctionDefinitionDocument): WrittenDatasetDetails {
  return { data: dataJsonOf(data, predicts.period) };
}

export function summarize(document: PredictionFunctionDefinitionDocument): DefinitionSummary {
  const { description, schemas } = document;
  return {
    ...(description === undefined ? {} : { description }),
    inputSchema: schemas.input,
    ...publishedOutputOf({ shape: seriesShape, details: datasetDetailsOf(document) }),
  };
}
