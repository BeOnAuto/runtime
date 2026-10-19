import { cacheFolderProblem } from '@on.auto/operations';
import { modelPorts, type ModelPorts } from '@on.auto/prediction';
import { processPool, type ProcessPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import type { PredictionSettings } from '../function-settings/prediction-settings.ts';
import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';

const mebibyte = 1_048_576;

export interface ServedModels {
  readonly pool: ProcessPool;
  readonly ports: ModelPorts;
}

async function checkedCacheFolder(directory: string): Promise<void> {
  const problem = await cacheFolderProblem(directory);
  if (problem !== undefined) {
    throw new InvalidSettingsError({
      message: `The prediction function settings are invalid. PREDICTION_CACHE_DIR: ${directory} ${problem}; name a folder that only the server's user may write to`,
    });
  }
}

export async function servedModels(settings: PredictionSettings): Promise<ServedModels> {
  const { processes, processMemoryMebibytes, buildsAtOnce, cacheDirectory, path } = settings;
  await checkedCacheFolder(cacheDirectory);
  const pool = processPool({ processes, longJobs: buildsAtOnce, memoryBytes: processMemoryMebibytes * mebibyte, path });
  const ports = modelPorts({ pool, scoringAtOnce: buildsAtOnce, directory: cacheDirectory });
  await Effect.runPromise(Effect.all([ports.caches.models.ready(), ports.caches.rows.ready()]));
  return { pool, ports };
}
