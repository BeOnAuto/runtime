import { join } from 'node:path';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { fileCache, mostCachedBytes, namedCache, rowsFileName } from '../model-cache/model-files.ts';
import { parsedRows } from '../model-cache/parsed-rows.ts';
import { modelProcesses, type ModelProcessSettings } from './model-processes.ts';
import { scoringPermits } from './scoring-permits.ts';

export const cacheDirectory = '/var/tmp/auto-runtime';

export interface ModelPortSettings extends ModelProcessSettings {
  readonly scoringAtOnce: number;
  readonly directory?: string;
  readonly mostBytes?: number;
}

export type ModelPorts = Pick<PredictionPorts, 'models' | 'caches' | 'permits'>;

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
