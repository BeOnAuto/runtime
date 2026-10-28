import { createHash } from 'node:crypto';

import { Conflict, contentOfBytes, type PlaybookAddress, type Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { ContentSource } from '../model-cache/model-files.ts';
import { fedShapeOf, fittingRuntimeFor, functionShapeOf } from '../runtimes/model-runtimes.ts';
import { activeVersionOf, type ActiveVersion } from './active-version.ts';
import { busy, crashedAs, ended } from './model-refusals.ts';

export interface AnsweringModel {
  readonly version: number | null;
  readonly file: string;
  readonly format: string;
  readonly source: ContentSource;
}

const noDefaultForecast = new Conflict({
  detail:
    'The function has no active version, and no model runtime this server has installed answers a function with none; ask for a build with the input { build: {} }',
  kind: 'no_active_version',
});

function activeModelOf(
  ports: Pick<PredictionPorts, 'ledger'>,
  playbook: PlaybookAddress,
  { version, file, format }: ActiveVersion,
): AnsweringModel {
  return { version, file, format, source: () => ports.ledger.content.get(playbook, file) };
}

function defaultForecastOf(
  ports: PredictionPorts,
  document: PredictionFunctionDefinitionDocument,
): Effect.Effect<AnsweringModel, Conflict | Unavailable> {
  const runtime = fittingRuntimeFor(ports.runtimes, fedShapeOf(document));
  if (runtime === undefined) {
    return Effect.fail(noDefaultForecast);
  }
  return Effect.flatMap(ports.models.defaultModel(runtime, functionShapeOf(document)), (outcome) => {
    if (outcome.ended === 'busy') {
      return Effect.fail(busy);
    }
    if (outcome.ended === 'crashed' || outcome.ended === 'badly') {
      return Effect.fail(crashedAs(outcome.detail));
    }
    if (outcome.ended !== 'answered') {
      return Effect.fail(ended);
    }
    const { format, bytes } = outcome.answer;
    return Effect.succeed({
      version: null,
      file: createHash('sha256').update(bytes).digest('hex'),
      format,
      source: () => Effect.succeed(contentOfBytes(bytes, 'application/octet-stream')),
    });
  });
}

export interface AnsweredFor {
  readonly playbook: PlaybookAddress;
  readonly name: string;
  readonly definitionVersion: number;
}

export function answeringModelOf(
  ports: PredictionPorts,
  document: PredictionFunctionDefinitionDocument,
  { playbook, name, definitionVersion }: AnsweredFor,
): Effect.Effect<AnsweringModel, Conflict | Unavailable> {
  return Effect.flatMap(
    activeVersionOf({ ledger: ports.ledger, playbook, name, definitionVersion, document }),
    (active) =>
      active === null ? defaultForecastOf(ports, document) : Effect.succeed(activeModelOf(ports, playbook, active)),
  );
}
