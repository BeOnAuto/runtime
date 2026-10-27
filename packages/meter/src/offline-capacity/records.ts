import type { ConnectionPorts } from '@on.auto/ledger';
import type { LicenseTrust, OfflineAllocation } from '@on.auto/metering';

import type { LicenseClock } from '../clock/records.ts';
import type { CurrentLicense, LicenseState } from '../license-state/records.ts';

export type CapacityState = 'open' | 'closing' | 'closed' | 'quarantined';

export interface CapacityReceipt {
  readonly id: string;
  readonly epoch: number;
  readonly state: CapacityState;
}

export interface CapacityCounter {
  readonly lotId: string;
  readonly reservedUnits: bigint;
  readonly committedUnits: bigint;
}

export interface CapacitySnapshot {
  readonly allocation: OfflineAllocation;
  readonly revision: number;
  readonly state: CapacityState;
  readonly checkpoint: string;
  readonly counters: readonly CapacityCounter[];
}

export interface OfflineCapacity {
  readonly install: (token: string) => Promise<CapacityReceipt & { readonly status: 'installed' | 'existing' }>;
  readonly snapshot: () => Promise<CapacitySnapshot | undefined>;
}

export interface CapacityOptions {
  readonly connection: ConnectionPorts;
  readonly clock: LicenseClock;
  readonly licenses: LicenseState;
  readonly trust: LicenseTrust;
}

export interface CapacityHead {
  readonly revision: number;
  readonly epoch: number;
  readonly currentId: string | null;
  readonly state: CapacityState | null;
}

export interface CapacityAuthority {
  readonly license: CurrentLicense;
  readonly now: number;
  readonly clockRevision: number;
}

export interface CapacityInstallation {
  readonly before: CapacityHead;
  readonly authority: CapacityAuthority;
  readonly allocation: OfflineAllocation;
  readonly token: string;
  readonly tokenDigest: string;
  readonly checkpoint: string;
}
