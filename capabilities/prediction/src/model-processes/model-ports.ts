import { join } from 'node:path';

import type { Unavailable } from '@on.auto/operations';
import type { ModelRuntime } from '@on.auto/prediction-contract';
import { Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { fileCache, mostCachedBytes, namedCache, rowsFileName } from '../model-cache/model-files.ts';
import { parsedRows } from '../model-cache/parsed-rows.ts';
import { unlicensedFeatureOf } from '../runtimes/model-runtimes.ts';
import { modelProcesses, type ModelFile, type ModelProcesses, type ModelProcessSettings } from './model-processes.ts';
import { scoringPermits } from './scoring-permits.ts';

export const cacheDirectory = '/var/tmp/auto-runtime';

export interface ModelPortSettings extends ModelProcessSettings {
  readonly scoringAtOnce: number;
  readonly directory?: string;
  readonly mostBytes?: number;
}

export interface ModelPorts extends Pick<PredictionPorts, 'caches' | 'permits'> {
  readonly models: ModelProcesses;
}

export function modelPorts(settings: ModelPortSettings): ModelPorts {
  const { scoringAtOnce, directory = cacheDirectory, mostBytes = mostCachedBytes } = settings;
  return {
    models: modelProcesses(settings),
    caches: {
      models: fileCache({ directory: join(directory, 'models'), mostBytes }),
      rows: namedCache(fileCache({ directory: join(directory, 'rows'), mostBytes }), rowsFileName),
      parsed: parsedRows(scoringAtOnce),
    },
    permits: scoringPermits(scoringAtOnce),
  };
}

interface Unlicensed {
  readonly ended: 'unlicensed';
  readonly feature: string;
  readonly milliseconds: number;
}

type Answered<Work extends (...given: readonly never[]) => Effect.Effect<unknown>, Placing = never> = Effect.Effect<
  Effect.Success<ReturnType<Work>> | Unlicensed,
  Unavailable | Placing
>;

export interface LicensedModels {
  readonly check: (
    org: string,
    runtime: ModelRuntime,
    model: ModelFile,
    fed: Parameters<ModelProcesses['check']>[2],
  ) => Answered<ModelProcesses['check']>;
  readonly run: <Placing>(
    org: string,
    runtime: ModelRuntime,
    placed: Effect.Effect<ModelFile, Placing>,
    question: Parameters<ModelProcesses['run']>[2],
  ) => Answered<ModelProcesses['run'], Placing>;
  readonly walk: <Placing>(
    org: string,
    runtime: ModelRuntime,
    placed: Effect.Effect<ModelFile, Placing>,
    walk: Parameters<ModelProcesses['walk']>[2],
  ) => Answered<ModelProcesses['walk'], Placing>;
  readonly fit: (
    org: string,
    runtime: ModelRuntime,
    rows: ModelFile,
    shape: Parameters<ModelProcesses['fit']>[2],
  ) => Answered<ModelProcesses['fit']>;
  readonly defaultModel: (
    org: string,
    runtime: ModelRuntime,
    shape: Parameters<ModelProcesses['defaultModel']>[1],
  ) => Answered<ModelProcesses['defaultModel']>;
  readonly window: ModelProcesses['window'];
  readonly baselines: ModelProcesses['baselines'];
}

function gated<Answer, Placing>(
  features: PredictionPorts['features'],
  { org, runtime }: { readonly org: string; readonly runtime: ModelRuntime },
  work: () => Effect.Effect<Answer, Placing>,
): Effect.Effect<Answer | Unlicensed, Unavailable | Placing> {
  return Effect.flatMap(
    unlicensedFeatureOf({ features, org }, runtime),
    (feature): Effect.Effect<Answer | Unlicensed, Placing> => {
      if (feature === undefined) {
        return work();
      }
      const unlicensed: Unlicensed = { ended: 'unlicensed', feature, milliseconds: 0 };
      return Effect.succeed(unlicensed);
    },
  );
}

export function licensedModelsOf(models: ModelProcesses, features: PredictionPorts['features']): LicensedModels {
  return {
    check: (org, runtime, model, fed) => gated(features, { org, runtime }, () => models.check(runtime, model, fed)),
    run: (org, runtime, placed, question) =>
      gated(features, { org, runtime }, () => Effect.flatMap(placed, (model) => models.run(runtime, model, question))),
    walk: (org, runtime, placed, walk) =>
      gated(features, { org, runtime }, () => Effect.flatMap(placed, (model) => models.walk(runtime, model, walk))),
    fit: (org, runtime, rows, shape) => gated(features, { org, runtime }, () => models.fit(runtime, rows, shape)),
    defaultModel: (org, runtime, shape) => gated(features, { org, runtime }, () => models.defaultModel(runtime, shape)),
    window: models.window,
    baselines: models.baselines,
  };
}
