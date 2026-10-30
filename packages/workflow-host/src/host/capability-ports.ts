import type { Capability, PlaybookOperation } from '@on.auto/definitions';
import type { LicensedFeaturesPorts } from '@on.auto/meter';
import type { PageFilters, ProgramPool } from '@on.auto/workflow-engine/dsl';

import type { HostDatabase } from '../database/host-database.ts';
import type { DueWork } from '../due-work/due-work.ts';
import type { SomeFolder } from '../projector/folder.ts';

export type CapabilityDatabase = Pick<HostDatabase, 'read' | 'write' | 'transaction' | 'readConsistently'>;

export type CapabilityPool = Omit<ProgramPool, 'close'>;

export type OwnSettings = ReadonlyMap<string, string>;

export interface CapabilityPorts {
  readonly database: CapabilityDatabase;
  readonly pool: CapabilityPool;
  readonly filters: PageFilters;
  readonly features: LicensedFeaturesPorts;
  readonly settings: OwnSettings;
  readonly mostFunctions: number;
  readonly triesBeforeStall: number;
}

export interface ProvidedCapability {
  readonly capability: Capability;
  readonly folders?: readonly SomeFolder[];
  readonly operations?: readonly PlaybookOperation[];
  readonly dueWork?: readonly DueWork[];
}

export type CapabilityFactory = (ports: CapabilityPorts) => ProvidedCapability;
