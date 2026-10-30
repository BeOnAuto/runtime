import { computationBounds, makeComputationFunctionAdapter } from '@on.auto/computation';
import type { Capability } from '@on.auto/definitions';
import { checkedAtSave, handedWorkersWithChecks } from '@on.auto/definitions/check';
import type { ShippedFiles } from '@on.auto/operations';
import { programPool, type CheckJob, type HandedWorkers, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect, Layer } from 'effect';

import type { ComputationSettings } from '../function-settings/computation-settings.ts';

export type ProgramPoolOf = (settings: ComputationSettings, handed: HandedWorkers) => ProgramPool;

export interface ServedComputation {
  readonly capability: Capability;
  readonly pool: ProgramPool;
  readonly check: (job: CheckJob) => ReturnType<typeof checkedAtSave>;
  readonly closedIfRefused: <Made>(making: () => Made) => Promise<Made>;
  readonly closedLastOf: <R>(services: Layer.Layer<R>) => Layer.Layer<R>;
}

export const workerPool: ProgramPoolOf = ({ workers }, handed) =>
  programPool({ workers, heapMegabytes: computationBounds.heapMegabytes, handed, instances: 'fresh' });

export async function computationServedBy(
  settings: ComputationSettings,
  poolOf: ProgramPoolOf,
  shippedFiles: ShippedFiles,
): Promise<ServedComputation> {
  const pool = poolOf(settings, await handedWorkersWithChecks(shippedFiles));
  return {
    capability: makeComputationFunctionAdapter({ pool }),
    pool,
    check: (job) => checkedAtSave(pool, job),
    closedIfRefused: async (making) => {
      try {
        return making();
      } catch (refusal) {
        await pool.close();
        throw refusal;
      }
    },
    closedLastOf: (services) =>
      Layer.provideMerge(services, Layer.effectDiscard(Effect.addFinalizer(() => Effect.promise(() => pool.close())))),
  };
}
