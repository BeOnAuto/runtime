import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { measuredEnvironment } from '@on.auto/operations/testing';
import type { PoolSettings } from '@on.auto/workflow-engine/dsl';
import { handedFileIn, type HandedFile } from '@on.auto/workflow-engine/job-loop';

import { checkShippedRoots, handedWorkersWithChecks, keptLibOf } from '../program-check/save-check.ts';

const checkFilesOnDisk = shippedFilesOnDisk(checkShippedRoots());

export const measuredPoolSettings: Pick<PoolSettings, 'handed' | 'instances' | 'environment'> = {
  handed: await handedWorkersWithChecks(checkFilesOnDisk),
  instances: 'fresh',
  environment: measuredEnvironment,
};

export const keptLibOnDisk: HandedFile = handedFileIn(await keptLibOf(checkFilesOnDisk));
