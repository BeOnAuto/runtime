import {
  frontMatterIn,
  reportedIssues,
  splitDocument,
  type DocumentParts,
  type ReadFrontMatter,
} from '@on.auto/definitions/document';
import { Result } from 'effect';

import { dataDigestOf } from '../data/data-digest.ts';
import type { Checked } from './checked-parts.ts';
import { derivedSchemasOf } from './derived-schemas.ts';
import { bodyIssues, doneOf, type Done } from './document-parts.ts';
import { decodeFrontMatter, predictionFrontMatter, type PredictionFrontMatter } from './front-matter.ts';
import type { PredictionFunctionDefinitionDocument } from './prediction-document.ts';

function assembled(
  front: PredictionFrontMatter,
  { predicts, data }: Done,
  lines: ReadFrontMatter['lines'],
): PredictionFunctionDefinitionDocument {
  return {
    ...(front.description === undefined ? {} : { description: front.description }),
    predicts,
    data: data.data,
    dataSha256: dataDigestOf(data.data, predicts.period),
    dataExpressions: data.expressions,
    schemas: derivedSchemasOf(predicts),
    lines,
  };
}

function documentFrom(reading: ReadFrontMatter, parts: DocumentParts): Checked<PredictionFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(reading.root);
  if (reading.issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...reading.issues, ...bodyIssues(parts)]);
  }
  const front = decoded.success;
  const done = doneOf(front, reading, bodyIssues(parts));
  return Result.map(done, (ready) => assembled(front, ready, reading.lines));
}

function documentOf(parts: DocumentParts): Checked<PredictionFunctionDefinitionDocument> {
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, predictionFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...bodyIssues(parts)])
    : documentFrom(reading.success, parts);
}

export function parsePredictionDocument(source: string): Checked<PredictionFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A prediction function definition'), documentOf),
    reportedIssues,
  );
}
