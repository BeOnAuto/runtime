import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { measuredEnvironment } from '@on.auto/operations/testing';

import { machineSandboxOf } from '../instances/host-sandboxes.ts';
import type { HandedFiles, HandedWorkers, PoolSettings } from '../jobs/pool-contract.ts';
import { handedWorkersOf } from '../program-pool/handed-files.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';

export const handedWorkers: HandedWorkers = await handedWorkersOf(shippedFilesOnDisk);

export const handedSandbox: HandedFiles = handedWorkers.sandbox;

export function testPoolSettings(workers: number): PoolSettings {
  return { workers, heapMegabytes: 64, environment: measuredEnvironment, handed: handedWorkers };
}

export function machineOnTheThread(): MachineSandbox {
  return machineSandboxOf(shippedFilesOnDisk);
}
