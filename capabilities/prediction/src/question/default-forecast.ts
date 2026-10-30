import { createHash } from 'node:crypto';

import { Conflict, contentOfBytes, type PlaybookAddress, type Unavailable } from '@on.auto/operations';
import type { ModelRuntime } from '@on.auto/prediction-contract';
import { Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { ContentSource } from '../model-cache/model-files.ts';
import {
  fedShapeOf,
  fittingRuntimeFor,
  functionShapeOf,
  licensedFor,
  executesFormat,
  refusedAs,
} from '../runtimes/model-runtimes.ts';
import { activeVersionOf, type ActiveVersion } from './active-version.ts';
import { busy, crashedAs, ended } from './model-refusals.ts';

interface DefaultBecause {
  readonly because: 'feature_unlicensed';
  readonly feature: string;
}

export interface AnsweringModel {
  readonly version: number | null;
  readonly file: string;
  readonly format: string;
  readonly source: ContentSource;
  readonly defaultBecause?: DefaultBecause;
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

function defaultModelOf(
  ports: PredictionPorts,
  { document, org }: Defaulting,
  runtime: ModelRuntime,
): Effect.Effect<AnsweringModel, Conflict | Unavailable> {
  const licensed = { ...ports, org };
  return Effect.flatMap(ports.models.defaultModel(org, runtime, functionShapeOf(document)), (outcome) => {
    if (outcome.ended === 'unlicensed') {
      return refusedAs(licensed, outcome.feature, `${runtime.name} needs to answer the default forecast`);
    }
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

interface Defaulting {
  readonly document: PredictionFunctionDefinitionDocument;
  readonly org: string;
}

function defaultForecastOf(
  ports: PredictionPorts,
  defaulting: Defaulting,
  refusal: Effect.Effect<never, Conflict | Unavailable> = Effect.fail(noDefaultForecast),
): Effect.Effect<AnsweringModel, Conflict | Unavailable> {
  const fitting = fittingRuntimeFor(licensedFor(ports, defaulting.org), fedShapeOf(defaulting.document));
  return Effect.flatMap(fitting, (runtime) =>
    runtime === undefined ? refusal : defaultModelOf(ports, defaulting, runtime),
  );
}

export function defaultInPlaceOf(
  ports: PredictionPorts,
  defaulting: Defaulting,
  { active, feature }: { readonly active: AnsweringModel; readonly feature: string },
): Effect.Effect<AnsweringModel, Conflict | Unavailable> {
  const which = `${executesFormat(active.format)}, the format of version ${String(active.version)}`;
  const refusal = refusedAs({ ...ports, org: defaulting.org }, feature, which);
  return Effect.map(defaultForecastOf(ports, defaulting, refusal), (answering): AnsweringModel => ({
    ...answering,
    defaultBecause: { because: 'feature_unlicensed', feature },
  }));
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
      active === null
        ? defaultForecastOf(ports, { document, org: playbook.org })
        : Effect.succeed(activeModelOf(ports, playbook, active)),
  );
}
