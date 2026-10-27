import type { AppRuntime } from '@on.auto/api';
import { RuntimeLicense } from '@on.auto/meter';
import { Effect } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import type { ServerServices } from '../server-options/composed-options.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import { defineActivateLicense } from './activate-license.ts';
import { keptLicenseKeyOn, type KeptLicenseKeyServices } from './kept-license-key.ts';
import { licenseChores } from './license-chores.ts';

const lastReportWithinMs = 5000;

interface Stopping {
  readonly stopWork: () => Promise<void>;
}

export interface ServedLicense {
  readonly operation: ReturnType<typeof defineActivateLicense>;
  readonly dueWork: ReturnType<typeof licenseChores>;
  readonly withALastReport: <S extends Stopping>(served: S) => S;
}

export async function licenseServedBy(
  runtime: AppRuntime<ServerServices>,
  givenKey: string | undefined,
  secrets: KeptLicenseKeyServices['secrets'],
): Promise<ServedLicense> {
  const inTheRuntime = <A, E>(work: Effect.Effect<A, E, ServerServices>) => Effect.runPromise(inRuntime(runtime, work));
  const license = await inTheRuntime(Effect.service(RuntimeLicense));
  const kept = keptLicenseKeyOn({ registry: runtimeLedger(runtime), secrets });
  const keptKey = givenKey === undefined ? await inTheRuntime(kept.read) : undefined;
  if (keptKey !== undefined) {
    await inTheRuntime(license.held(keptKey));
  }
  return {
    operation: defineActivateLicense(license, kept),
    dueWork: licenseChores(license),
    withALastReport: (served) => ({
      ...served,
      stopWork: async () => {
        await served.stopWork();
        await inTheRuntime(Effect.ignore(Effect.timeoutOption(license.reported, lastReportWithinMs)));
      },
    }),
  };
}
