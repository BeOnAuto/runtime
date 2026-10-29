import type { CapabilityRejection, RunContext } from '@on.auto/definitions';
import { Unavailable } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { Assembled } from '../facts/build-facts.ts';
import type { DatasetFiles } from '../files/files-refusals.ts';
import { fedShapeOf, fittingRuntimeFor } from '../runtimes/model-runtimes.ts';
import { keptBrief } from './build-brief.ts';
import { buildRecordOf, trainerlessRecordOf } from './build-request.ts';

const nothingFits = new Unavailable({
  detail:
    'The function names no trainer under source, and no model runtime this server has installed fits its own models for it; name a trainer, or install a runtime that fits its own',
  kind: 'model_process_failed',
  because: 'no_model_runtime',
});

export interface Recording {
  readonly ports: PredictionPorts;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly context: RunContext;
  readonly files: DatasetFiles;
  readonly now: number;
}

export function deferredRecordOf(
  { ports, document, context, files, now }: Recording,
  assembled: Assembled,
): Effect.Effect<Schema.JsonObject, CapabilityRejection> {
  const { org, playbook, id, definition } = context;
  const { source } = document;
  if (source === undefined) {
    return Effect.succeed(trainerlessRecordOf(assembled));
  }
  return Effect.map(
    keptBrief(ports.ledger.content, { org, playbook }, document, {
      name: definition.name,
      files,
      runtimes: ports.runtimes,
    }),
    (brief) =>
      buildRecordOf({ run: { org, playbook, id }, name: definition.name, source, assembled, brief, requestedAt: now }),
  );
}

export function fitsWhenNoneTrains(
  ports: PredictionPorts,
  document: PredictionFunctionDefinitionDocument,
): Effect.Effect<void, Unavailable> {
  return document.source === undefined && fittingRuntimeFor(ports.runtimes, fedShapeOf(document)) === undefined
    ? Effect.fail(nothingFits)
    : Effect.void;
}
