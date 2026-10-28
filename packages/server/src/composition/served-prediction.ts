import type { AppRuntime } from '@on.auto/api';
import { openRequestsName } from '@on.auto/interaction';
import type { DispatcherServices } from '@on.auto/operations';
import type { PredictionPorts } from '@on.auto/prediction';
import type { WorkflowStore } from '@on.auto/workflow-host';

import { logPredictionFunctions } from '../logging/prediction-logging.ts';
import type { ServedClosing } from '../server-options/server-options.ts';
import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';
import { servedModels } from './served-models.ts';

export interface ServedPrediction {
  readonly ports: PredictionPorts;
  readonly withProcessesClosed: ServedClosing;
}

export async function predictionServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { prediction, interaction }: Pick<Settings, 'prediction' | 'interaction'>,
  { store, runtimes }: { readonly store: WorkflowStore; readonly runtimes: PredictionPorts['runtimes'] },
): Promise<ServedPrediction> {
  const { mostFunctions, processes, processMemoryMebibytes, buildsAtOnce, buildsPerDay, cacheDirectory } = prediction;
  const { pool, inline, ports: models } = await servedModels(prediction);
  await runtime.run(
    logPredictionFunctions({
      mostFunctions,
      processes,
      memoryMebibytes: processMemoryMebibytes,
      buildsAtOnce,
      buildsPerDay,
      cacheDirectory,
      limiter: pool.limiter,
    }),
  );
  const ledger = runtimeLedger(runtime);
  return {
    ports: {
      ledger,
      database: store.database,
      runtimes,
      ...models,
      bounds: { buildsPerDay, buildsAtOnce, mostOpenRequests: interaction.mostOpenRequests },
      openRequests: (playbook) =>
        ledger.countProjectedRows(openRequestsName, playbook, [{ column: 'open', equals: true }]),
    },
    withProcessesClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        inline.close();
        await pool.close();
      },
    }),
  };
}
