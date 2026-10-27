import type { AppRuntime } from '@on.auto/api';
import { defineRunDefinition, type Capability } from '@on.auto/definitions';
import { makeDispatcher, type DispatcherServices, type HttpRegistration } from '@on.auto/operations';
import {
  activateVersion,
  buildsDue,
  datasetFolder,
  datasetsPortOn,
  makePredictionFunctionAdapter,
  readBuildBrief,
  readBuildRows,
  uploadCandidate,
  uploadDataset,
} from '@on.auto/prediction';
import { recallBounds } from '@on.auto/recall';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { someFolder, type DueWork, type SomeFolder, type WorkflowStore } from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import { nestedRuns } from '../workflows/host-work.ts';
import { predictionServedBy, type ServedPrediction } from './served-prediction.ts';

interface PlaybookRoute {
  readonly registration: HttpRegistration<'playbook'>;
}

export interface ServedPredictionFunctions extends ServedPrediction {
  readonly capability: Capability;
  readonly routes: readonly PlaybookRoute[];
  readonly dueWorkFor: (capabilities: readonly Capability[]) => readonly DueWork[];
}

export function datasetsFolderOf(pool: ProgramPool): SomeFolder {
  return someFolder(
    datasetFolder({ filters: pool.evaluations.filters, triesBeforeStall: recallBounds.overtimesBeforeStall }),
  );
}

export async function predictionFunctionsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Pick<Settings, 'prediction' | 'interaction'> & { readonly cloudDevelopmentOnly: boolean },
  pool: ProgramPool,
  store: WorkflowStore,
): Promise<ServedPredictionFunctions> {
  const { ports, withProcessesClosed } = await predictionServedBy(runtime, settings, store);
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
      ...(settings.cloudDevelopmentOnly ? [] : [uploadCandidate(ports)]),
      activateVersion,
    ],
    dueWorkFor: (capabilities) =>
      settings.cloudDevelopmentOnly
        ? []
        : [buildsDue({ ports, runs: nestedRuns(runtime, makeDispatcher([]), defineRunDefinition(capabilities)) })],
  };
}
