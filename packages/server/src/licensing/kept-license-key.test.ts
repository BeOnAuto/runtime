import { Conflict } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { secretStoreOn } from '@on.auto/secrets';
import { memoryKeeper, memoryKeeperRefusal, memoryRows } from '@on.auto/secrets/testing';
import { DateTime, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptLicenseKeyOn } from './kept-license-key.ts';

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

const key = 'alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.c2VjcmV0';

const rotated = 'alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.cm90YXRlZA';

function keptIn() {
  const ledger = memoryLedger();
  const keeper = memoryKeeper();
  const secrets = secretStoreOn(memoryRows({ now }), { current: keeper });
  return { ledger, keeper, secrets, kept: keptLicenseKeyOn({ registry: ledger.service, secrets }) };
}

function failureOf(work: Effect.Effect<unknown, { readonly detail: string }>): Promise<string> {
  return Effect.runPromise(Effect.map(Effect.flip(work), ({ detail }) => detail));
}

describe('the license key a runtime keeps', () => {
  it('is none before one is kept, then the key last kept, the one before it forgotten', async () => {
    const { kept, keeper } = keptIn();
    const before = await Effect.runPromise(kept.read);
    await Effect.runPromise(kept.keep(key, 'person:ada'));
    const first = await Effect.runPromise(kept.read);
    await Effect.runPromise(kept.keep(rotated, 'person:ada'));

    expect([before, first, await Effect.runPromise(kept.read)]).toEqual([undefined, key, rotated]);
    expect(keeper.released()).toHaveLength(1);
  });

  it('is none when the secret store cannot read it, and refused as unavailable when it cannot keep it', async () => {
    const { kept, keeper } = keptIn();
    await Effect.runPromise(kept.keep(key, 'person:ada'));
    keeper.refuse();

    expect(await Effect.runPromise(kept.read)).toBeUndefined();
    expect(await failureOf(kept.keep(rotated, 'person:ada'))).toBe(
      `The license is active, but its key could not be kept in the secret store, so it must be activated again after a restart: ${memoryKeeperRefusal}`,
    );
  });

  it('forgets the secret it kept when the ledger does not record it', async () => {
    const { ledger, keeper, secrets } = keptIn();
    const refusing = {
      ...ledger.service,
      execute: () => Effect.fail(new Conflict({ kind: 'concurrent_change', detail: 'Another change came first' })),
    };
    const kept = keptLicenseKeyOn({ registry: refusing, secrets });

    expect(await failureOf(kept.keep(key, 'person:ada'))).toContain('Another change came first');
    expect(keeper.released()).toHaveLength(1);
  });
});
