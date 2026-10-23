import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { measuredEnvironment } from '@on.auto/operations/testing';

import { sandboxModuleIn, sandboxShippedRoots } from '../instances/compiled-module.ts';
import { freshInstances } from '../instances/fresh-instances.ts';
import { machineSandboxOf } from '../instances/host-sandboxes.ts';
import type { InstanceSource, SandboxModule } from '../instances/instance-source.ts';
import { InstanceSourceNameSchema, instanceSources, type InstanceSourceName } from '../instances/instance-sources.ts';
import type { HandedFiles, HandedWorkers, PoolSettings } from '../jobs/pool-contract.ts';
import { handedWorkersOf } from '../program-pool/handed-files.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';

export interface SourceUnderTest {
  readonly name: InstanceSourceName;
  readonly source: InstanceSource;
}

export const sandboxFilesOnDisk = shippedFilesOnDisk(sandboxShippedRoots);

export const sandboxModuleOnDisk: SandboxModule = await sandboxModuleIn(sandboxFilesOnDisk);

export const handedWorkers: HandedWorkers = await handedWorkersOf(sandboxFilesOnDisk);

export const handedSandbox: HandedFiles = handedWorkers.sandbox;

export const sourcesUnderTest: readonly SourceUnderTest[] = InstanceSourceNameSchema.literals.map((name) => ({
  name,
  source: instanceSources[name](sandboxModuleOnDisk),
}));

export function testPoolSettings(workers: number): PoolSettings {
  return { workers, heapMegabytes: 64, environment: measuredEnvironment, handed: handedWorkers, instances: 'fresh' };
}

export function machineOnTheThread(): MachineSandbox {
  return machineSandboxOf(freshInstances(sandboxModuleOnDisk));
}
