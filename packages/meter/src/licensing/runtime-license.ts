import { Conflict, type Unavailable } from '@on.auto/operations';
import { Context, Effect } from 'effect';

import type { SignedReport } from '../accounts/account-service.ts';
import { allocationRefreshed } from '../allocations/allocation-refresh.ts';
import { allocationReportMade, allocationReportSent } from '../allocations/allocation-reports.ts';
import { allocated, type AllocationStanding } from '../allocations/allocation.ts';
import { activated } from './activation.ts';
import type { Licensing } from './licensing.ts';
import { reported } from './reports.ts';
import { autoSigners, type Signed, type Signers } from './signed-answers.ts';

interface Worded {
  readonly detail: string;
}

export interface LicenseStanding {
  readonly installation: string;
  readonly org: string;
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
}

const noKeyToSignWith = new Conflict({
  detail:
    'This runtime holds no license key to sign its report with: give it the key of its installation in AUTO_RUNTIME_LICENSE_KEY, or in license.key of its configuration file',
});

export interface LicenseGiven {
  readonly key: string | undefined;
  readonly signers: Signers;
}

export const unlicensed: LicenseGiven = { key: undefined, signers: autoSigners };

export class RuntimeLicense extends Context.Service<RuntimeLicense, LicensePorts>()('@on.auto/meter/RuntimeLicense') {}

function refreshedBy(licensing: Licensing): Effect.Effect<void, Unavailable> {
  return Effect.gen(function* () {
    const key = yield* licensing.keyInHand;
    if (key === undefined) return;
    yield* allocationRefreshed(licensing, key);
    yield* activated(licensing, key).pipe(
      Effect.catchTag('conflict', ({ detail }: Worded) =>
        Effect.logWarning(`The license of this runtime could not be refreshed: ${detail}`),
      ),
    );
  });
}

export function licensePortsOf(licensing: Licensing): LicensePorts {
  return {
    activate: (key) =>
      Effect.map(activated(licensing, key), ({ installation, org, plan, expires_at: expiresAt }) => ({
        installation,
        org,
        plan,
        expires_at: expiresAt,
      })),
    held: licensing.keyHeld,
    refreshed: refreshedBy(licensing),
    reported: Effect.flatMap(licensing.keyInHand, (key) =>
      key === undefined
        ? reported(licensing)
        : Effect.andThen(allocationReportSent(licensing, key), reported(licensing)),
    ),
    allocate: (allocation) => allocated(licensing, allocation),
    allocationReport: (of) =>
      Effect.flatMap(licensing.keyInHand, (key) =>
        key === undefined ? Effect.fail(noKeyToSignWith) : allocationReportMade(licensing, key, of),
      ),
  };
}
