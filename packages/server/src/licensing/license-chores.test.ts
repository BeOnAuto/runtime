import { Unavailable } from '@on.auto/operations';
import { Effect, Layer, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { askAgainAfterMs, licenseChores, refreshEveryMs, reportEveryMs } from './license-chores.ts';

type Chore = ReturnType<typeof licenseChores>[number];

async function nextDueOf(chore: Chore, now: number, logging: Layer.Layer<never> = Layer.empty): Promise<number | null> {
  const [item] = await Effect.runPromise(chore.due(now, 1, true));
  await Effect.runPromise((item?.perform(now) ?? Effect.void).pipe(Effect.provide(logging)));
  return Effect.runPromise(chore.nextDueAt(now));
}

describe('the chores of a license', () => {
  it('refresh the entitlement every day and report every hour, from when each was done', async () => {
    const [refresh, report] = licenseChores({ refreshed: Effect.void, reported: Effect.void });

    expect(await Promise.all([nextDueOf(refresh, 1000), nextDueOf(report, 1000)])).toEqual([
      1000 + refreshEveryMs,
      1000 + reportEveryMs,
    ]);
  });

  it('ask again in 15 minutes when the account could not be asked, and say so', async () => {
    const lines: string[] = [];
    const logging = Logger.layer([
      Logger.make(({ message }: { readonly message: unknown }) => {
        lines.push(String(message));
      }),
    ]);
    const failing = Effect.fail(new Unavailable({ detail: 'The account service could not be reached' }));
    const [refresh, report] = licenseChores({ refreshed: failing, reported: failing });

    expect([await nextDueOf(refresh, 1000, logging), await nextDueOf(report, 1000, logging)]).toEqual([
      1000 + askAgainAfterMs,
      1000 + askAgainAfterMs,
    ]);
    expect(lines).toEqual([
      'The license of this runtime could not be refreshed: The account service could not be reached; it asks again in 15 minutes',
      'This runtime could not report its actions to Auto: The account service could not be reached; it asks again in 15 minutes',
    ]);
  });
});
