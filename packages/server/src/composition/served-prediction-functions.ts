import type { Capability } from '@on.auto/definitions';
import { datasetFolder, datasetsPortOn, makePredictionFunctionAdapter } from '@on.auto/prediction';
import { recallBounds } from '@on.auto/recall';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { someFolder, type SomeFolder, type WorkflowStore } from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';

export function datasetsFolderOf(pool: ProgramPool): SomeFolder {
  return someFolder(
    datasetFolder({ filters: pool.evaluations.filters, triesBeforeStall: recallBounds.overtimesBeforeStall }),
  );
}

export function predictionFunctionsServedBy(
  { prediction }: Pick<Settings, 'prediction'>,
  pool: ProgramPool,
  { database }: WorkflowStore,
): Capability {
  return makePredictionFunctionAdapter({
    pool,
    database,
    datasets: datasetsPortOn(database),
    mostFunctions: prediction.mostFunctions,
  });
}
