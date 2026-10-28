import type { AppRuntime } from '@on.auto/api';
import { RuntimeLicense, type KeyInHand, type Signed } from '@on.auto/meter';
import { Effect, Function } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import type { ServerServices } from '../server-options/composed-options.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import { keptLicenseKeyOn, type KeptLicenseKeyServices } from './kept-license-key.ts';
import { licenseChores } from './license-chores.ts';
import { licenseNoticeOf } from './license-notice.ts';
import { licenseOperationsOf } from './license-operations.ts';

const lastReportWithinMs = 5000;

interface Stopping {
  readonly stopWork: () => Promise<void>;
}

interface Worded {
  readonly detail: string;
}

export interface ServedLicense {
  readonly operations: ReturnType<typeof licenseOperationsOf>;
  readonly dueWork: ReturnType<typeof licenseChores>;
  readonly notice: () => Promise<string | undefined>;
  readonly withALastReport: <S extends Stopping>(served: S) => S;
}

export async function licenseServedBy(
  runtime: AppRuntime<ServerServices>,
  given: { readonly key: KeyInHand | undefined; readonly allocation: Signed | undefined },
  secrets: KeptLicenseKeyServices['secrets'],
): Promise<ServedLicense> {
  const inTheRuntime = <A, E>(work: Effect.Effect<A, E, ServerServices>) => Effect.runPromise(inRuntime(runtime, work));
  const license = await inTheRuntime(Effect.service(RuntimeLicense));
  const kept = keptLicenseKeyOn({ registry: runtimeLedger(runtime), secrets });
  const keptKey = given.key === undefined ? await inTheRuntime(kept.read) : undefined;
  if (keptKey !== undefined) {
    await inTheRuntime(license.held(keptKey));
  }
  if (given.allocation !== undefined) {
    await inTheRuntime(
      license
        .allocate(given.allocation)
        .pipe(
          Effect.catch(({ detail }: Worded) =>
            Effect.logWarning(`The runtime did not take the allocation its settings give: ${detail}`),
          ),
        ),
    );
  }
  return {
    operations: licenseOperationsOf(license, kept),
    dueWork: licenseChores(license),
    notice: () =>
      inTheRuntime(license.status.pipe(Effect.map(licenseNoticeOf), Effect.orElseSucceed(Function.constUndefined))),
    withALastReport: (served) => ({
      ...served,
      stopWork: async () => {
        await served.stopWork();
        await inTheRuntime(Effect.ignore(Effect.timeoutOption(license.reported, lastReportWithinMs)));
      },
    }),
  };
}
