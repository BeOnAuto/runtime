import { Unavailable } from '@on.auto/operations';
import { Effect, Layer, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { askAgainAfterMs, licenseChores, lookEveryMs, refreshEveryMs, reportEveryMs } from './license-chores.ts';

type Chore = ReturnType<typeof licenseChores>[number];

async function nextDueOf(chore: Chore, now: number, logging: Layer.Layer<never> = Layer.empty): Promise<number | null> {
  const [item] = await Effect.runPromise(chore.due(now, 1, true));
  await Effect.runPromise((item?.perform(now) ?? Effect.void).pipe(Effect.provide(logging)));
  return Effect.runPromise(chore.nextDueAt(now));
}

interface Counted {
  readonly reports: () => number;
  readonly reported: Effect.Effect<void, Unavailable>;
}

function countedReports(failing = false): Counted {
  const made = { reports: 0 };
  return {
    reports: () => made.reports,
    reported: Effect.suspend(() => {
      made.reports += 1;
      return failing
        ? Effect.fail(new Unavailable({ detail: 'The account service could not be reached' }))
        : Effect.void;
    }),
  };
}

describe('the chores of a license', () => {
  it('refresh offline credits every day, and report at once, then every hour, looking every minute for an early report', async () => {
    const counted = countedReports();
    const [refresh, report] = licenseChores({
      allocationRefreshed: Effect.void,
      reported: counted.reported,
      reportDue: Effect.succeed(false),
    });

    expect(await nextDueOf(refresh, 1000)).toBe(1000 + refreshEveryMs);
    expect(await nextDueOf(report, 1000)).toBe(1000 + lookEveryMs);
    expect(await nextDueOf(report, 1000 + reportEveryMs - 1)).toBe(1000 + reportEveryMs);
    expect(await nextDueOf(report, 1000 + reportEveryMs)).toBe(1000 + reportEveryMs + lookEveryMs);
    expect(counted.reports()).toBe(2);
  });
});

describe('the report of a license', () => {
  it('is made early once one is due, at most once a minute', async () => {
    const counted = countedReports();
    const [, report] = licenseChores({
      allocationRefreshed: Effect.void,
      reported: counted.reported,
      reportDue: Effect.succeed(true),
    });
    await nextDueOf(report, 0);
    await nextDueOf(report, lookEveryMs - 1);
    await nextDueOf(report, lookEveryMs);

    expect(counted.reports()).toBe(2);
  });

  it('is asked again in 15 minutes when the account could not be asked, early or not, which it says', async () => {
    const lines: string[] = [];
    const logging = Logger.layer([
      Logger.make(({ message }: { readonly message: unknown }) => {
        lines.push(String(message));
      }),
    ]);
    const counted = countedReports(true);
    const [, report] = licenseChores({
      allocationRefreshed: Effect.void,
      reported: counted.reported,
      reportDue: Effect.succeed(true),
    });

    expect(await nextDueOf(report, 1000, logging)).toBe(1000 + lookEveryMs);
    await nextDueOf(report, 1000 + askAgainAfterMs - 1, logging);
    await nextDueOf(report, 1000 + askAgainAfterMs, logging);
    expect(counted.reports()).toBe(2);
    expect(lines.at(0)).toBe(
      'This runtime could not report its runs to Auto: The account service could not be reached; it asks again in 15 minutes',
    );
  });
});
