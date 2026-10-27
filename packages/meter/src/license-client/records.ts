import type { ConnectionPorts } from '@on.auto/ledger';
import type { InstallationChallenge, LicenseTrust } from '@on.auto/metering';

import type { ClockSamples, LicenseClock } from '../clock/records.ts';
import type { InstallationIdentity, InstallationStorage } from '../installation/records.ts';
import type { CurrentLicense, LicenseHead, LicenseState } from '../license-state/records.ts';
import type { LicenseFetch, LicenseProtocol } from '../licensing/records.ts';

export interface PendingExchange {
  readonly expectedRevision: number;
  readonly challenge: InstallationChallenge;
}

export interface LicenseClientOptions extends InstallationStorage {
  readonly trust: LicenseTrust;
  readonly clock: ClockSamples;
  readonly fetch: LicenseFetch;
}

export interface LicenseClient {
  readonly head: () => Promise<LicenseHead>;
  readonly current: () => Promise<CurrentLicense>;
  readonly activate: (activationKey: string) => Promise<CurrentLicense>;
  readonly refresh: () => Promise<CurrentLicense>;
  readonly resume: () => Promise<CurrentLicense | undefined>;
  readonly poll: () => Promise<LicensePollResult>;
}

export interface LicensePollResult {
  readonly status: 'idle' | 'refreshed' | 'failed';
  readonly retryInMilliseconds: number;
}

export interface ClientServices {
  readonly connection: ConnectionPorts;
  readonly installation: InstallationIdentity;
  readonly trust: LicenseTrust;
  readonly clock: LicenseClock;
  readonly state: LicenseState;
  readonly protocol: LicenseProtocol;
}
