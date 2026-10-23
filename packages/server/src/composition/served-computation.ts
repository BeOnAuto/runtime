import { computationBounds, makeComputationFunctionAdapter } from '@on.auto/computation';
import type { Capability } from '@on.auto/definitions';
import { checkedAtSave, handedWorkersWithChecks } from '@on.auto/definitions/check';
import type { ShippedFiles } from '@on.auto/operations';
import { programPool, type CheckJob, type HandedWorkers, type ProgramPool } from '@on.auto/workflow-engine/dsl';

import type { ComputationSettings } from '../function-settings/computation-settings.ts';
import type { Served } from '../server-options/server-options.ts';

export type ProgramPoolOf = (settings: ComputationSettings, handed: HandedWorkers) => ProgramPool;

export interface ServedComputation {
  readonly capability: Capability;
  readonly pool: ProgramPool;
  readonly check: (job: CheckJob) => ReturnType<typeof checkedAtSave>;
  readonly withPoolClosed: (served: Served) => Served;
}

export const workerPool: ProgramPoolOf = ({ workers }, handed) =>
  programPool({ workers, heapMegabytes: computationBounds.heapMegabytes, handed });

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
    withPoolClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await pool.close();
      },
    }),
  };
}
