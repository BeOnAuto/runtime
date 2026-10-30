import type { LicensePorts } from '@on.auto/meter';
import { choreWork, type DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

export const reportEveryMs = 3_600_000;

export const refreshEveryMs = 86_400_000;

export const askAgainAfterMs = 900_000;

export const lookEveryMs = 60_000;

interface Worded {
  readonly detail: string;
}

interface Reporting {
  reportAt: number;
  earlyAt: number;
}

type Reports = Pick<LicensePorts, 'reported' | 'reportDue'>;

function isDue(license: Reports, kept: Readonly<Reporting>, now: number): Effect.Effect<boolean> {
  if (now >= kept.reportAt) return Effect.succeed(true);
  return now >= kept.earlyAt ? license.reportDue : Effect.succeed(false);
}

function reportedWhenDue(license: Reports): (now: number) => Effect.Effect<number> {
  const kept: Reporting = { reportAt: Number.NEGATIVE_INFINITY, earlyAt: Number.NEGATIVE_INFINITY };
  const reported = license.reported.pipe(
    Effect.as(true),
    Effect.catch(({ detail }: Worded) =>
      Effect.as(
        Effect.logWarning(`This runtime could not report its runs to Auto: ${detail}; it asks again in 15 minutes`),
        false,
      ),
    ),
  );
  return (now) =>
    Effect.gen(function* () {
      if (yield* isDue(license, kept, now)) {
        const taken = yield* reported;
        kept.reportAt = now + (taken ? reportEveryMs : askAgainAfterMs);
        kept.earlyAt = now + (taken ? lookEveryMs : askAgainAfterMs);
      }
      return Math.min(kept.reportAt, now + lookEveryMs);
    });
}

export function licenseChores(
  license: Pick<LicensePorts, 'allocationRefreshed' | 'reported' | 'reportDue'>,
): readonly [DueWork, DueWork] {
  return [
    choreWork({
      name: 'allocation refresh',
      perform: (now) => Effect.as(license.allocationRefreshed, now + refreshEveryMs),
    }),
    choreWork({ name: 'usage report', perform: reportedWhenDue(license) }),
  ];
}
