import type { Conflict, Unavailable } from '@on.auto/operations';
import { Context, Effect } from 'effect';

import type { SignedReport } from '../accounts/account-service.ts';
import { refreshedDaily } from '../allocations/allocation-refresh.ts';
import { allocationReportOf, reportedHourly } from '../allocations/allocation-reports.ts';
import { allocated, type AllocationStanding } from '../allocations/allocation.ts';
import { activated } from './activation.ts';
import { licenseStatusOf, type LicenseStatus } from './license-status.ts';
import type { KeyInHand, Licensing } from './licensing.ts';
import { autoSigners, type Signed, type Signers } from './signed-answers.ts';

export interface LicenseStanding {
  readonly installation: string;
  readonly org: string;
  readonly org_name: string | null;
  readonly plan: string;
  readonly expires_at: string;
}

export interface LicensePorts {
  readonly activate: (key: string) => Effect.Effect<LicenseStanding, Conflict | Unavailable>;
  readonly held: (key: string) => Effect.Effect<void>;
  readonly refreshed: Effect.Effect<void, Unavailable>;
  readonly reported: Effect.Effect<void, Unavailable>;
  readonly allocate: (allocation: Signed) => Effect.Effect<AllocationStanding, Conflict | Unavailable>;
  readonly allocationReport: (of: string | undefined) => Effect.Effect<SignedReport, Conflict | Unavailable>;
  readonly status: Effect.Effect<LicenseStatus, Unavailable>;
}

export interface LicenseGiven {
  readonly key: KeyInHand | undefined;
  readonly signers: Signers;
}

export const unlicensed: LicenseGiven = { key: undefined, signers: autoSigners };

export class RuntimeLicense extends Context.Service<RuntimeLicense, LicensePorts>()('@on.auto/meter/RuntimeLicense') {}

export function licensePortsOf(licensing: Licensing): LicensePorts {
  return {
    activate: (key) =>
      Effect.map(
        activated(licensing, key),
        ({ installation, org, org_name: orgName, plan, expires_at: expiresAt }) => ({
          installation,
          org,
          org_name: orgName,
          plan,
          expires_at: expiresAt,
        }),
      ),
    held: licensing.keyHeld,
    refreshed: refreshedDaily(licensing),
    reported: reportedHourly(licensing),
    allocate: (allocation) => allocated(licensing, allocation),
    allocationReport: (of) => allocationReportOf(licensing, of),
    status: licenseStatusOf(licensing),
  };
}
