import type { CreditSource } from '../funding/lots.ts';
import type { InstallationBinding, LicenseEntitlement, LicenseMode, LicenseRing } from '../licenses/entitlements.ts';

export const OFFLINE_ALLOCATION_TYPE = 'auto-offline-allocation+jws';
export const MOST_ALLOCATION_TOKEN_CHARACTERS = 65_536;

export interface AllocatedSource {
  readonly lotId: string;
  readonly source: CreditSource;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly units: bigint;
}

export interface OfflineAllocation extends InstallationBinding {
  readonly issuer: string;
  readonly ring: LicenseRing;
  readonly id: string;
  readonly epoch: number;
  readonly mode: LicenseMode;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly sources: readonly AllocatedSource[];
}

export interface ExpectedAllocation {
  readonly license: LicenseEntitlement;
  readonly minimumEpoch: number;
  readonly now: number;
}
