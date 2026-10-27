import type { ConnectionPorts } from '@on.auto/ledger';
import type { InstallationChallenge, LicenseEntitlement, LicenseTrust } from '@on.auto/metering';

import type { LicenseTime } from '../clock/records.ts';
import type { InstallationIdentity } from '../installation/records.ts';

export interface LicenseHead {
  readonly revision: number;
  readonly generation: number;
  readonly state: 'unlicensed' | 'active' | 'refused';
  readonly accountId: string | null;
  readonly installationId: string | null;
  readonly serial: string | null;
}

export interface LicenseRecordRequest {
  readonly expectedRevision: number;
  readonly challenge: InstallationChallenge;
  readonly entitlementToken: string;
  readonly allocationTokens: readonly string[];
  readonly now: number;
}

interface LicenseReceipt {
  readonly serial: string;
  readonly generation: number;
  readonly revision: number;
}

export type LicenseRecordResult =
  | ({ readonly status: 'accepted' | 'existing' } & LicenseReceipt)
  | { readonly status: 'conflict' };

export interface CurrentLicense {
  readonly revision: number;
  readonly license: LicenseEntitlement;
}

export interface LicenseState {
  readonly head: () => Promise<LicenseHead>;
  readonly record: (request: LicenseRecordRequest) => Promise<LicenseRecordResult>;
  readonly refuse: (expectedRevision: number) => Promise<boolean>;
  readonly current: (time: LicenseTime) => Promise<CurrentLicense>;
}

export interface LicenseStateOptions {
  readonly connection: ConnectionPorts;
  readonly installation: InstallationIdentity;
  readonly trust: LicenseTrust;
}

export interface LicenseHistory extends LicenseReceipt {
  readonly token: string;
  readonly challengePayload: string;
  readonly allocationJson: string;
}
