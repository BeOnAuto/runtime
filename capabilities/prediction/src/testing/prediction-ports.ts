import { runOutcomeMapping } from '@on.auto/definitions';
import type { KeyedProjection, RecordedContent } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { predictionBuilds } from '../builds/builds-projection.ts';
import type { BuildBounds, PredictionPorts } from '../capability/prediction-ports.ts';
import {
  licensedModelsOf,
  modelPorts,
  type ModelPorts,
  type ModelPortSettings,
} from '../model-processes/model-ports.ts';
import { predictionModels } from '../models/models-projection.ts';
import { scriptedFeaturesOf, scriptedRuntime, type ScriptedLicense } from '../runtime-testing/scripted-runtime.ts';
import { closedAfterTheTest, scratchDirectory } from './scratch.ts';

export interface PortOptions extends Pick<ModelPortSettings, 'module' | 'deadlines' | 'mostBytes'> {
  readonly database?: PredictionPorts['database'];
  readonly bounds?: Partial<BuildBounds>;
  readonly processes?: number;
  readonly longJobs?: number;
  readonly openRequests?: number;
  readonly runtimes?: PredictionPorts['runtimes'];
  readonly license?: ScriptedLicense;
  readonly features?: PredictionPorts['features'];
  readonly projections?: readonly KeyedProjection[];
  readonly content?: (kept: RecordedContent) => RecordedContent;
  readonly models?: (processes: ModelPorts['models']) => ModelPorts['models'];
}

export interface TestPorts {
  readonly ports: PredictionPorts;
  readonly ledger: MemoryLedger;
  readonly directory: string;
}

const emptyHostDatabase: PredictionPorts['database'] = {
  readConsistently: (reads) => reads(() => Effect.succeed([])),
};

export function testPorts(options: PortOptions = {}): TestPorts {
  const directory = scratchDirectory();
  const ledger = memoryLedger(runOutcomeMapping, [predictionBuilds, predictionModels, ...(options.projections ?? [])]);
  const processes = options.processes ?? 4;
  const modelled = modelPorts({
    ...options,
    pool: closedAfterTheTest(processes, options.longJobs),
    scoringAtOnce: Math.max(1, processes - 2),
    directory,
  });
  const features = options.features ?? scriptedFeaturesOf(options.license ?? { features: [] });
  const ports: PredictionPorts = {
    ledger:
      options.content === undefined
        ? ledger.service
        : { ...ledger.service, content: options.content(ledger.service.content) },
    database: options.database ?? emptyHostDatabase,
    runtimes: options.runtimes ?? [scriptedRuntime],
    features,
    ...modelled,
    models: licensedModelsOf(
      options.models === undefined ? modelled.models : options.models(modelled.models),
      features,
    ),
    bounds: { buildsPerDay: 4, buildsAtOnce: 2, mostOpenRequests: 64, ...options.bounds },
    openRequests: () => Effect.succeed(options.openRequests ?? 0),
  };
  return { ports, ledger, directory };
}
