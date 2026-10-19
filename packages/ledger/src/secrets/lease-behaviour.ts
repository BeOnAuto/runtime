import { randomUUIDv7 } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  aDatabaseWithItsLedger,
  aKey,
  aLease,
  aStoreOn,
  at,
  firstMoment,
  isoOf,
  kept,
  kidOf,
  kidsIn,
  readBack,
  rowsIn,
  stateAt,
  type SecretsEntry,
} from './secret-store-entry.ts';

function replacingBehaviour(entry: SecretsEntry): void {
  it('replaces the value of a row whose version is the one read, at the next version, kept when it was replaced', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });
    const id = await at(firstMoment, store.keep(Redacted.make('first-tokens-1234'), '1234'));

    const replaced = await at(firstMoment + 1000, store.replace(id, 1, Redacted.make('second-tokens')));
    const [row] = await rowsIn(entry, database);

    expect(replaced).toEqual({ replaced: true, version: 2 });
    expect(await stateAt(store, id, firstMoment + 1000)).toEqual({
      value: 'second-tokens',
      version: 2,
      claimedUntil: undefined,
    });
    expect(row).toMatchObject({ id, kid: store.kid, kept_at: isoOf(firstMoment + 1000) });
    expect(row?.sealed.includes('second-tokens')).toBe(false);
    expect(await Effect.runPromise(store.endingsOf([id]))).toEqual(new Map());
  });

  it('replaces nothing of a row whose version moved or that is gone, and says so', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });
    const id = await kept(store, 'first-tokens');

    const first = await Effect.runPromise(store.replace(id, 1, Redacted.make('second-tokens')));
    const moved = await Effect.runPromise(store.replace(id, 1, Redacted.make('other-tokens')));
    const held = await readBack(store, id);
    await Effect.runPromise(store.forget(id));
    const gone = await Effect.runPromise(store.replace(id, 2, Redacted.make('third-tokens')));
    const unknown = await Effect.runPromise(store.replace(randomUUIDv7(), 1, Redacted.make('third-tokens')));

    expect([first, moved, gone, unknown]).toEqual([
      { replaced: true, version: 2 },
      { replaced: false },
      { replaced: false },
      { replaced: false },
    ]);
    expect(held).toBe('second-tokens');
    expect(await stateAt(store, id, firstMoment)).toBeUndefined();
  });
}

function refusedReplacementBehaviour(entry: SecretsEntry): void {
  it('refuses an empty value and one of more than 8 KiB as it refuses to keep them, and keeps the value it holds', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });
    const id = await kept(store, 'first-tokens');

    const refusals = await Effect.runPromise(
      Effect.forEach(['', 'x'.repeat(8193)], (value) => Effect.flip(store.replace(id, 1, Redacted.make(value)))),
    );

    expect(refusals).toEqual([
      expect.objectContaining({ _tag: 'secret_refused', because: 'empty', detail: 'A secret to keep is empty' }),
      expect.objectContaining({ because: 'too_large', detail: 'A secret to keep holds more than 8 KiB' }),
    ]);
    expect(await stateAt(store, id, firstMoment)).toEqual({
      value: 'first-tokens',
      version: 1,
      claimedUntil: undefined,
    });
  });
}

function claimingBehaviour(entry: SecretsEntry): void {
  it('claims a row of the version read until a time, which a read answers while the claim is open', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });
    const id = await kept(store, 'first-tokens');

    const claim = await at(firstMoment, store.claim(id, 1, aLease));

    expect(claim).toEqual({ claimed: true, until: isoOf(firstMoment + aLease) });
    expect(await stateAt(store, id, firstMoment + aLease - 1)).toEqual({
      value: 'first-tokens',
      version: 1,
      claimedUntil: isoOf(firstMoment + aLease),
    });
    expect(await stateAt(store, id, firstMoment + aLease)).toMatchObject({ version: 1, claimedUntil: undefined });
  });

  it('claims nothing while a claim is open, of a version that moved or of a row that is gone, and again once a claim ended', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });
    const id = await kept(store, 'first-tokens');

    const claims = [
      await at(firstMoment, store.claim(id, 1, aLease)),
      await at(firstMoment + aLease - 1, store.claim(id, 1, aLease)),
      await at(firstMoment + aLease, store.claim(id, 2, aLease)),
      await at(firstMoment + aLease, store.claim(id, 1, aLease)),
    ];
    await Effect.runPromise(store.forget(id));
    const gone = await at(firstMoment + 3 * aLease, store.claim(id, 1, aLease));

    expect([...claims, gone]).toEqual([
      { claimed: true, until: isoOf(firstMoment + aLease) },
      { claimed: false },
      { claimed: false },
      { claimed: true, until: isoOf(firstMoment + 2 * aLease) },
      { claimed: false },
    ]);
  });
}

function claimsEndedBehaviour(entry: SecretsEntry): void {
  it('ends a claim with the replacement, so the next version may be claimed at once', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });
    const id = await kept(store, 'first-tokens');

    await at(firstMoment, store.claim(id, 1, aLease));
    const replaced = await at(firstMoment + 1000, store.replace(id, 1, Redacted.make('second-tokens')));
    const state = await stateAt(store, id, firstMoment + 1000);
    const claim = await at(firstMoment + 1000, store.claim(id, 2, aLease));

    expect(replaced).toEqual({ replaced: true, version: 2 });
    expect(state).toEqual({ value: 'second-tokens', version: 2, claimedUntil: undefined });
    expect(claim).toEqual({ claimed: true, until: isoOf(firstMoment + 1000 + aLease) });
  });

  it('keeps the version and the claim of each row the rotation of its key re-seals', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const [previous, current] = [aKey(), aKey()];
    const sealing = await aStoreOn(entry, database, { current: previous });
    const id = await kept(sealing, 'first-tokens');
    await Effect.runPromise(sealing.replace(id, 1, Redacted.make('second-tokens')));
    await at(firstMoment, sealing.claim(id, 2, aLease));
    const rotating = await aStoreOn(entry, database, { current, previous });

    const resealed = await Effect.runPromise(rotating.rotated());

    expect(resealed).toBe(1);
    expect(await kidsIn(entry, database)).toEqual({ [kidOf(current)]: 1 });
    expect(await stateAt(rotating, id, firstMoment)).toEqual({
      value: 'second-tokens',
      version: 2,
      claimedUntil: isoOf(firstMoment + aLease),
    });
  });
}

export function leaseBehaviour(entry: SecretsEntry): void {
  describe('a row replaced under a lease', () => {
    replacingBehaviour(entry);
    refusedReplacementBehaviour(entry);
    claimingBehaviour(entry);
    claimsEndedBehaviour(entry);
  });
}
