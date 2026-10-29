import {
  defineRunDefinition,
  type Capability,
  type ExtensionPoint,
  type ImplementationsProvided,
} from '@on.auto/definitions';
import { makeDispatcher, type HttpRegistration } from '@on.auto/operations';
import {
  activateVersion,
  buildsDue,
  datasetFolder,
  datasetsPortOn,
  makePredictionFunctionAdapter,
  modelRuntimePoint,
  readBuildBrief,
  readBuildRows,
  uploadCandidate,
  uploadDataset,
} from '@on.auto/prediction';
import { recallBounds } from '@on.auto/recall';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { someFolder, type DueWork, type SomeFolder } from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import { nestedRuns } from '../workflows/host-work.ts';
import { predictionServedBy, type PredictionServing, type ServedPrediction } from './served-prediction.ts';

interface PlaybookRoute {
  readonly registration: HttpRegistration<'playbook'>;
}

export interface ServedPredictionFunctions extends ServedPrediction {
  readonly capability: Capability;
  readonly routes: readonly PlaybookRoute[];
  readonly dueWorkFor: (capabilities: readonly Capability[]) => DueWork;
}

export const predictionExtensionPoints: readonly ExtensionPoint[] = [modelRuntimePoint];

export function datasetsFolderOf(pool: ProgramPool): SomeFolder {
  return someFolder(
    datasetFolder({ filters: pool.evaluations.filters, triesBeforeStall: recallBounds.overtimesBeforeStall }),
  );
}

export async function predictionFunctionsServedBy(
  runtime: Parameters<typeof predictionServedBy>[0],
  settings: Pick<Settings, 'prediction' | 'interaction'>,
  pool: ProgramPool,
  {
    store,
    provided,
    features,
    modelProcesses,
  }: Omit<PredictionServing, 'runtimes'> & {
    readonly provided: ImplementationsProvided;
  },
): Promise<ServedPredictionFunctions> {
  const runtimes = provided(modelRuntimePoint);
  const { ports, withProcessesClosed } = await predictionServedBy(runtime, settings, {
    store,
    runtimes,
    features,
    modelProcesses,
  });
  return {
    ports,
    withProcessesClosed,
    capability: makePredictionFunctionAdapter({
      pool,
      datasets: datasetsPortOn(store.database),
      ports,
      mostFunctions: settings.prediction.mostFunctions,
    }),
    routes: [
      uploadDataset(ports.ledger.content),
      readBuildBrief,
      readBuildRows,
      uploadCandidate(ports),
      activateVersion,
    ],
    dueWorkFor: (capabilities) =>
      buildsDue({ ports, runs: nestedRuns(runtime, makeDispatcher([]), defineRunDefinition(capabilities)) }),
  };
}
