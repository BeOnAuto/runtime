import type { InstallationChallenge, LicenseEntitlement, LicenseTrust } from '@on.auto/metering';

import type { InstallationSigner } from '../installation/records.ts';

export type LicenseFetch = (request: Readonly<Request>) => Promise<Readonly<Response>>;
type LicensePath = '/licenses/activation-challenge' | '/licenses/refresh-challenge' | '/licenses/complete';
export type LicenseTransport = (path: LicensePath, value: unknown) => Promise<unknown>;

export interface LicenseProtocolOptions {
  readonly trust: LicenseTrust;
  readonly installation: InstallationSigner;
  readonly fetch: LicenseFetch;
}

export interface VerifiedLicenseBundle {
  readonly entitlementToken: string;
  readonly license: LicenseEntitlement;
  readonly allocationTokens: readonly string[];
}

export interface LicenseProtocol {
  readonly activationChallenge: (requestId: string, activationKey: string) => Promise<InstallationChallenge>;
  readonly refreshChallenge: (requestId: string, installationId: string) => Promise<InstallationChallenge>;
  readonly complete: (challenge: InstallationChallenge, now: number) => Promise<VerifiedLicenseBundle>;
}
