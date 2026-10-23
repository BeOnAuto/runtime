import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { measuredEnvironment } from '@on.auto/operations/testing';
import type { PoolSettings } from '@on.auto/workflow-engine/dsl';
import { handedFileIn, type HandedFile } from '@on.auto/workflow-engine/job-loop';

import { handedWorkersWithChecks, keptLibOf } from '../program-check/save-check.ts';

export const measuredPoolSettings: Pick<PoolSettings, 'handed' | 'instances' | 'environment'> = {
  handed: await handedWorkersWithChecks(shippedFilesOnDisk),
  instances: 'fresh',
  environment: measuredEnvironment,
};

export const keptLibOnDisk: HandedFile = handedFileIn(await keptLibOf(shippedFilesOnDisk));
