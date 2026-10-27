import { licenseIdentifier } from '../licenses/claim-values.ts';
import type { InstallationBinding, LicenseRing } from '../licenses/entitlements.ts';
import type { RunIdentity } from '../runs/identity.ts';

export const OFFLINE_REPORT_TYPE = 'auto-offline-report+jws';
export const MOST_REPORT_TOKEN_CHARACTERS = 131_072;

export function assertOfflineRunIdentity(run: Pick<RunIdentity, 'playbookId' | 'runId'>): void {
  licenseIdentifier(run.playbookId);
  licenseIdentifier(run.runId);
}

export interface ReportCounter {
  readonly lotId: string;
  readonly committedUnits: bigint;
  readonly reservedUnits: bigint;
}

export interface OfflineChargePart {
  readonly lotId: string;
  readonly units: bigint;
}

export interface OfflineRunCharge {
  readonly playbookId: string;
  readonly runId: string;
  readonly evidenceDigest: string;
  readonly admittedAt: number;
  readonly committedAt: number;
  readonly parts: readonly OfflineChargePart[];
}

export interface OfflineUsageReport extends InstallationBinding {
  readonly issuer: string;
  readonly ring: LicenseRing;
  readonly allocationId: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly previousCheckpoint: string;
  readonly reportedAt: number;
  readonly close: boolean;
  readonly counters: readonly ReportCounter[];
  readonly charges: readonly OfflineRunCharge[];
}
