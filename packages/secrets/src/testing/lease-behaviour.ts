import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { aSecretsKey } from './recording-custodian.ts';
import {
  aLease,
  at,
  firstMoment,
  isoOf,
  kept,
  kidOf,
  kidsIn,
  rowsIn,
  stateAt,
  storeOn,
  type SecretsEntry,
} from './secrets-entry.ts';

function replacedAtTheNextVersion(entry: SecretsEntry): void {
  it('replaces the value of a row whose version is the one read, at the next version, under a new data key, kept when it was replaced', async () => {
    const database = await entry.aDatabase();
    const key = aSecretsKey();
    const store = await storeOn(entry, database, { current: key });
    const id = await at(firstMoment, store.keep(Redacted.make('first-tokens-1234'), '1234'));
    const [before] = await rowsIn(entry, database);

    const replaced = await at(firstMoment + 1000, store.replace(id, 1, Redacted.make('second-tokens')));
    const [row] = await rowsIn(entry, database);

    expect(replaced).toEqual({ replaced: true, version: 2 });
    expect(await stateAt(store, id, firstMoment + 1000)).toEqual({
      value: 'second-tokens',
      version: 2,
      claimedUntil: undefined,
    });
    expect(row).toMatchObject({ id, kept_by: 'ledger', kid: kidOf(key), kept_at: isoOf(firstMoment + 1000) });
    expect(row?.held.includes('second-tokens')).toBe(false);
    expect(row?.held).not.toBe(before?.held);
    expect(row?.wrapped_key).not.toBe(before?.wrapped_key);
  });
}

function replacementsRefused(entry: SecretsEntry): void {
  it('refuses an empty value and one of more than 8 KiB as it refuses to keep them, and keeps the value it holds', async () => {
    const database = await entry.aDatabase();
    const store = await storeOn(entry, database, { current: aSecretsKey() });
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

function leaseKeptByTheRotation(entry: SecretsEntry): void {
  it('keeps the version and the claim of each row the rotation of its key wraps again', async () => {
    const database = await entry.aDatabase();
    const [previous, current] = [aSecretsKey(), aSecretsKey()];
    const sealing = await storeOn(entry, database, { current: previous });
    const id = await kept(sealing, 'first-tokens');
    await Effect.runPromise(sealing.replace(id, 1, Redacted.make('second-tokens')));
    await at(firstMoment, sealing.claim(id, 2, aLease));
    const rotating = await storeOn(entry, database, { current, previous });

    const rewrapped = await Effect.runPromise(rotating.rotated());

    expect(rewrapped).toBe(1);
    expect(await kidsIn(entry, database)).toEqual({ [kidOf(current)]: 1 });
    expect(await stateAt(rotating, id, firstMoment)).toEqual({
      value: 'second-tokens',
      version: 2,
      claimedUntil: isoOf(firstMoment + aLease),
    });
  });
}

export function storeLeaseBehaviour(entry: SecretsEntry): void {
  describe('a value replaced under a lease', () => {
    replacedAtTheNextVersion(entry);
    replacementsRefused(entry);
    leaseKeptByTheRotation(entry);
  });
}
