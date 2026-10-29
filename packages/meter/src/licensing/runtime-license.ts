import type { Conflict, Unavailable } from '@on.auto/operations';
import { Context, Effect } from 'effect';

import { allocationPortsOf, type AllocationPorts } from '../allocations/allocation-ports.ts';
import { licenseStatusOf } from '../standing/license-status.ts';
import type { LicenseStatus } from '../standing/status-document.ts';
import { activated } from './activation.ts';
import type { KeyInHand, Licensing } from './licensing.ts';
import { reportDue } from './reports.ts';
import { autoSigners, type Signers } from './signed-answers.ts';

export interface LicensePorts extends AllocationPorts {
  readonly activate: (key: string) => Effect.Effect<LicenseStatus, Conflict | Unavailable>;
  readonly held: (key: string) => Effect.Effect<void>;
  readonly reportDue: Effect.Effect<boolean>;
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
    ...allocationPortsOf(licensing),
    activate: (key) => Effect.andThen(activated(licensing, key), licenseStatusOf(licensing)),
    held: licensing.keyHeld,
    reportDue: reportDue(licensing),
    status: licenseStatusOf(licensing),
  };
}
