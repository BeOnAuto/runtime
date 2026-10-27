import type { LicensePorts } from '@on.auto/meter';
import { choreWork, type DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

export const reportEveryMs = 3_600_000;

export const refreshEveryMs = 86_400_000;

export const askAgainAfterMs = 900_000;

interface Worded {
  readonly detail: string;
}

function everyOr(
  work: Effect.Effect<void, Worded>,
  everyMs: number,
  what: string,
): (now: number) => Effect.Effect<number> {
  return (now) =>
    work.pipe(
      Effect.as(now + everyMs),
      Effect.catch(({ detail }: Worded) =>
        Effect.as(Effect.logWarning(`${what}: ${detail}; it asks again in 15 minutes`), now + askAgainAfterMs),
      ),
    );
}

export function licenseChores(license: Pick<LicensePorts, 'refreshed' | 'reported'>): readonly [DueWork, DueWork] {
  return [
    choreWork({
      name: 'license refresh',
      perform: everyOr(license.refreshed, refreshEveryMs, 'The license of this runtime could not be refreshed'),
    }),
    choreWork({
      name: 'usage report',
      perform: everyOr(license.reported, reportEveryMs, 'This runtime could not report its actions to Auto'),
    }),
  ];
}
