import { randomUUIDv7 } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';
import { decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import { aLedger } from '../testing/ledger-entry.ts';
import { leaseBehaviour } from './lease-behaviour.ts';
import {
  aDatabaseWithItsLedger,
  aKey,
  aStoreOn,
  at,
  firstMoment,
  isoOf,
  kept,
  keptEach,
  kidOf,
  kidsIn,
  readBack,
  rowsIn,
  type SecretsEntry,
} from './secret-store-entry.ts';

const uuidV7 = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

function keepingBehaviour(entry: SecretsEntry): void {
  it('keeps a value under an id of its own, a UUIDv7, at its first version, and reads it back redacted', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });

    const ids = await at(
      firstMoment,
      Effect.forEach(['pasted-key', 'pasted-key'], (value) => store.keep(Redacted.make(value))),
    );
    const read = await Effect.runPromise(store.read(String(ids[0])));
    const rows = await rowsIn(entry, database);

    expect(ids).toEqual([expect.stringMatching(uuidV7), expect.stringMatching(uuidV7)]);
    expect(new Set(ids).size).toBe(2);
    expect(JSON.stringify({ read })).toBe('{"read":{"value":"<redacted>","version":1}}');
    expect(await Promise.all(ids.map((id) => readBack(store, id)))).toEqual(['pasted-key', 'pasted-key']);
    expect(rows.map(({ id }) => id)).toEqual(ids.toSorted());
    expect(rows.map(({ sealed }) => sealed.includes('pasted-key'))).toEqual([false, false]);
    expect(rows[0]?.sealed).not.toBe(rows[1]?.sealed);
    expect(rows.map(({ kept_at }) => kept_at)).toEqual([isoOf(firstMoment), isoOf(firstMoment)]);
  });

  it('seals each value as one JWE whose protected header names the key that wrapped it', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const key = aKey();
    const store = await aStoreOn(entry, database, { current: key });

    await kept(store, 'pasted-key');
    const [row] = await rowsIn(entry, database);

    expect(store.kid).toBe(kidOf(key));
    expect(store.kid).toMatch(/^[\da-f]{16}$/u);
    expect(row?.kid).toBe(store.kid);
    expect(row?.sealed.split('.')).toHaveLength(5);
    expect(decodeProtectedHeader(String(row?.sealed))).toEqual({ alg: 'A256KW', enc: 'A256GCM', kid: store.kid });
  });

  it('answers nothing for an id it does not keep, and forgets a value, twice as once', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });
    const id = await kept(store, 'pasted-key');

    await Effect.runPromise(Effect.andThen(store.forget(id), store.forget(id)));

    expect([await readBack(store, randomUUIDv7()), await readBack(store, id)]).toEqual([undefined, undefined]);
    expect(await rowsIn(entry, database)).toEqual([]);
  });
}

function endingBehaviour(entry: SecretsEntry): void {
  it('keeps the ending it is given beside the value, answers it by id, and forgets it with the value', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });
    const [ending, none] = [
      await Effect.runPromise(store.keep(Redacted.make('crm-key-1234'), '1234')),
      await kept(store, 'pasted-key'),
    ];

    const endings = await Effect.runPromise(store.endingsOf([ending, none, randomUUIDv7()]));
    await Effect.runPromise(store.forget(ending));

    expect(endings).toEqual(new Map([[ending, '1234']]));
    expect(await Effect.runPromise(store.endingsOf([ending]))).toEqual(new Map());
    expect(await Effect.runPromise(store.endingsOf([]))).toEqual(new Map());
  });
}

function refusalBehaviour(entry: SecretsEntry): void {
  it('cannot read a value sealed under another key, and names that key and never the value', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const sealing = aKey();
    const id = await kept(await aStoreOn(entry, database, { current: sealing }), 'pasted-key');
    const other = await aStoreOn(entry, database, { current: aKey() });

    const refused = await Effect.runPromise(Effect.flip(other.read(id)));

    expect(refused).toMatchObject({
      _tag: 'secret_key_unknown',
      kid: kidOf(sealing),
      detail: `The secret is sealed under the key ${kidOf(sealing)}, which is neither the current key nor the previous one`,
    });
    expect(JSON.stringify(refused)).not.toContain('pasted-key');
  });

  it('refuses an empty value and one of more than 8 KiB of UTF-8, and keeps neither', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const store = await aStoreOn(entry, database, { current: aKey() });

    const refusals = await Effect.runPromise(
      Effect.forEach(['', 'x'.repeat(8193), 'é'.repeat(4097)], (value) =>
        Effect.flip(store.keep(Redacted.make(value))),
      ),
    );
    const largest = await keptEach(store, ['x'.repeat(8192), 'é'.repeat(4096)]);

    expect(refusals).toEqual([
      expect.objectContaining({ _tag: 'secret_refused', because: 'empty', detail: 'A secret to keep is empty' }),
      expect.objectContaining({ because: 'too_large', detail: 'A secret to keep holds more than 8 KiB' }),
      expect.objectContaining({ because: 'too_large', detail: 'A secret to keep holds more than 8 KiB' }),
    ]);
    expect(await Promise.all(largest.map((id) => readBack(store, id)))).toEqual(['x'.repeat(8192), 'é'.repeat(4096)]);
    expect(await rowsIn(entry, database)).toHaveLength(2);
  });

  it('opens only with keys of 32 bytes, naming the length of the other and never its bytes', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const short = { current: Redacted.make(new Uint8Array(16)) };
    const long = { current: aKey(), previous: Redacted.make(new Uint8Array(33)) };

    await expect(Effect.runPromise(entry.secretStoreOn(database, short))).rejects.toThrow(
      'A key that seals secrets is 32 bytes, and this one is 16',
    );
    await expect(Effect.runPromise(entry.secretStoreOn(database, long))).rejects.toThrow(
      'A key that seals secrets is 32 bytes, and this one is 33',
    );
  });
}

function rotationBehaviour(entry: SecretsEntry): void {
  it('reads with its previous key, and re-seals in batches what that key sealed under the current one, leaving the rest', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const [previous, current, stray] = [aKey(), aKey(), aKey()];
    const values = Array.from({ length: 101 }, (_, index) => `pasted-key-${index}`);
    const ids = await keptEach(await aStoreOn(entry, database, { current: previous }), values);
    const strayId = await kept(await aStoreOn(entry, database, { current: stray }), 'stray-key');
    const rotating = await aStoreOn(entry, database, { current, previous });
    const keptAt = (await rowsIn(entry, database)).map((row) => row.kept_at);

    const readBefore = await readBack(rotating, String(ids[0]));
    const resealed = await Effect.runPromise(rotating.rotated());
    const afterwards = await aStoreOn(entry, database, { current });

    expect({ readBefore, resealed }).toEqual({ readBefore: 'pasted-key-0', resealed: 101 });
    expect(await kidsIn(entry, database)).toEqual({ [kidOf(current)]: 101, [kidOf(stray)]: 1 });
    expect((await rowsIn(entry, database)).map((row) => row.kept_at)).toEqual(keptAt);
    expect(await Promise.all(ids.map((id) => readBack(afterwards, id)))).toEqual(values);
    expect(await Effect.runPromise(rotating.rotated())).toBe(0);
    expect(await Effect.runPromise(Effect.flip(rotating.read(strayId)))).toMatchObject({ kid: kidOf(stray) });
  });

  it('re-seals nothing without a previous key, or with the current key given as the previous one', async () => {
    const database = await aDatabaseWithItsLedger(entry);
    const key = aKey();
    const alone = await aStoreOn(entry, database, { current: key });
    const id = await kept(alone, 'pasted-key');
    const twice = await aStoreOn(entry, database, { current: key, previous: key });

    const resealed = [await Effect.runPromise(alone.rotated()), await Effect.runPromise(twice.rotated())];

    expect(resealed).toEqual([0, 0]);
    expect(await readBack(twice, id)).toBe('pasted-key');
  });
}

function olderShapeBehaviour(entry: SecretsEntry): void {
  it('refuses a database whose table of secrets has an older shape when the ledger opens, with words that say to delete it', async () => {
    const database = await entry.aDatabase();
    await entry.queried(
      database,
      'CREATE TABLE sealed_secrets (id TEXT PRIMARY KEY, kid TEXT NOT NULL, sealed TEXT NOT NULL, kept_at TEXT NOT NULL, ends_with TEXT)',
    );

    await expect(aLedger(entry, database)).rejects.toThrow(
      "The ledger's database keeps secrets in a shape this server no longer reads: sealed_secrets has the columns ends_with, id, kept_at, kid, sealed, where this server keeps claimed_until, ends_with, id, kept_at, kid, sealed, version. Nothing stored before launch is carried over, so delete the local database and start the server again",
    );
  });
}

export function secretsBehaviour(entry: SecretsEntry): void {
  describe('the secrets it keeps sealed', () => {
    keepingBehaviour(entry);
    endingBehaviour(entry);
    refusalBehaviour(entry);
    rotationBehaviour(entry);
    leaseBehaviour(entry);
    olderShapeBehaviour(entry);
  });
}
