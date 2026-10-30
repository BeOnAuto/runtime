import { isAbsolute } from 'node:path';

import type { Environment } from '@on.auto/config';
import { cacheDirectory } from '@on.auto/prediction';
import { Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn, type CountBounds } from './counted-settings.ts';

interface ModelProcesses {
  readonly processes: number;
  readonly processMemoryMebibytes: number;
  readonly buildsAtOnce: number;
}

export interface PredictionSettings extends ModelProcesses {
  readonly mostFunctions: number;
  readonly buildsPerDay: number;
  readonly cacheDirectory: string;
  readonly path: string | undefined;
}

const processes: CountBounds = { setting: 'PREDICTION_PROCESSES', least: 2, most: 64, example: 4 };

const processMemoryMebibytes: CountBounds = {
  setting: 'PREDICTION_PROCESS_MEMORY',
  least: 768,
  most: 16_384,
  example: 1280,
};

const buildsAtOnce: CountBounds = { setting: 'PREDICTION_BUILDS_AT_ONCE', least: 1, most: 63, example: 2 };

const buildsPerDay: CountBounds = { setting: 'PREDICTION_BUILDS_PER_DAY', least: 1, most: 100, example: 4 };

const mostFunctions: CountBounds = { setting: 'PREDICTION_MAX_FUNCTIONS', least: 1, most: 1000, example: 32 };

const cacheSetting = 'PREDICTION_CACHE_DIR';

export const predictionVariables: readonly string[] = [
  ...[processes, processMemoryMebibytes, buildsAtOnce, buildsPerDay, mostFunctions].map(({ setting }) => setting),
  cacheSetting,
  'PATH',
];

function belowTheProcesses(settings: ModelProcesses): readonly string[] {
  return settings.buildsAtOnce < settings.processes
    ? []
    : [
        `${buildsAtOnce.setting}: Expected a whole number below ${processes.setting}, ${settings.processes}, so that a prediction always finds a model process`,
      ];
}

function cacheDirectoryIn(environment: Environment): Effect.Effect<string, InvalidSettingsError> {
  const written = (environment[cacheSetting] ?? '').trim();
  if (written === '') {
    return Effect.succeed(cacheDirectory);
  }
  return isAbsolute(written)
    ? Effect.succeed(written)
    : Effect.fail(
        new InvalidSettingsError({
          message: `The prediction function settings are invalid. ${cacheSetting}: Expected an absolute path, such as ${cacheDirectory}`,
        }),
      );
}

export function readPredictionSettings(
  environment: Environment,
): Effect.Effect<PredictionSettings, InvalidSettingsError> {
  const counted = countsIn(environment, {
    settings: 'prediction function settings',
    bounds: { processes, processMemoryMebibytes, buildsAtOnce, buildsPerDay, mostFunctions },
    beyondTheRanges: (counts) => belowTheProcesses(counts),
  });
  return Effect.zipWith(counted, cacheDirectoryIn(environment), (counts, kept) => ({
    ...counts,
    cacheDirectory: kept,
    path: environment['PATH'],
  }));
}
