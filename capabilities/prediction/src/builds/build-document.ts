import { definitionVersionIn } from '@on.auto/definitions';
import type { PlaybookAddress, StreamReader } from '@on.auto/operations';
import { Effect, Option, Result } from 'effect';

import { predictionDefinitionType } from '../capability/prediction-bounds.ts';
import { parsePredictionDocument } from '../document/document-parsing.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { BuildState } from './build-state.ts';

export function documentOfVersion(
  reader: StreamReader,
  playbook: PlaybookAddress,
  name: string,
  version: number,
): Effect.Effect<PredictionFunctionDefinitionDocument> {
  return Effect.map(definitionVersionIn(reader, playbook, { type: predictionDefinitionType, name, version }), (found) =>
    Result.getOrThrow(parsePredictionDocument(Option.getOrThrow(Option.fromNullishOr(found)).source)),
  );
}

export function documentOfBuild(
  reader: StreamReader,
  { address, run }: BuildState,
): Effect.Effect<PredictionFunctionDefinitionDocument> {
  const { org, playbook } = address;
  return documentOfVersion(reader, { org, playbook }, run.run.name, run.run.definition_version);
}
