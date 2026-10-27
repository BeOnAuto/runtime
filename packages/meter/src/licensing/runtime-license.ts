import type { Conflict, Unavailable } from '@on.auto/operations';
import { Context, Effect } from 'effect';

import { activated } from './activation.ts';
import type { Licensing } from './licensing.ts';
import { reported } from './reports.ts';
import { autoSigners, type Signers } from './signed-answers.ts';

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
}

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
    reported: reported(licensing),
  };
}
