import { randomUUIDv7 } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';
import { compactDecrypt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import { localCustodian } from '../custodians/local-custodian.ts';
import { storeLeaseBehaviour } from './lease-behaviour.ts';
import { aSecretsKey, custodianRefusal, recordingCustodian } from './recording-custodian.ts';
import {
  at,
  firstMoment,
  isoOf,
  kept,
  keptEach,
  kidOf,
  kidsIn,
  readBack,
  rowsIn,
  storeOn,
  storeWith,
  type SecretsEntry,
} from './secrets-entry.ts';

const uuidV7 = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

type Key = Redacted.Redacted<Uint8Array>;

function dataKeyOf(key: Key, wrappedKey: string | null): Promise<Key> {
  return Effect.runPromise(localCustodian(key).unwrap(String(wrappedKey)));
}

async function hexOfTheDataKey(key: Key, wrappedKey: string | null): Promise<string> {
  return Buffer.from(Redacted.value(await dataKeyOf(key, wrappedKey))).toString('hex');
}

async function openedWith(
  key: Key,
  { held, wrapped_key }: { readonly held: string; readonly wrapped_key: string | null },
): Promise<string> {
  const { plaintext } = await compactDecrypt(held, Redacted.value(await dataKeyOf(key, wrapped_key)));
  return new TextDecoder().decode(plaintext);
}

function keptUnderAnIdOfItsOwn(entry: SecretsEntry): void {
  it('keeps a value under an id of its own, a UUIDv7, at its first version with the ending it is given, and reads it back redacted', async () => {
    const database = await entry.aDatabase();
    const store = await storeOn(entry, database, { current: aSecretsKey() });

    const ids = await at(
      firstMoment,
      Effect.all([store.keep(Redacted.make('pasted-key')), store.keep(Redacted.make('pasted-key'), '-key')]),
    );
    const read = await Effect.runPromise(store.read(ids[0]));
    const rows = await rowsIn(entry, database);

    expect(ids).toEqual([expect.stringMatching(uuidV7), expect.stringMatching(uuidV7)]);
    expect(new Set(ids).size).toBe(2);
    expect(JSON.stringify({ read })).toBe('{"read":{"value":"<redacted>","version":1}}');
    expect(await Promise.all(ids.map((id) => readBack(store, id)))).toEqual(['pasted-key', 'pasted-key']);
    expect(rows.map(({ id }) => id)).toEqual(ids.toSorted());
    expect(rows.map(({ held, wrapped_key }) => `${held}${String(wrapped_key)}`.includes('pasted-key'))).toEqual([
      false,
      false,
    ]);
    expect(rows[0]?.held).not.toBe(rows[1]?.held);
    expect(rows.map(({ kept_at }) => kept_at)).toEqual([isoOf(firstMoment), isoOf(firstMoment)]);
    expect(new Map(rows.map(({ id, ends_with }) => [id, ends_with]))).toEqual(
      new Map([
        [ids[0], null],
        [ids[1], '-key'],
      ]),
    );
  });
}

function sealedUnderADataKeyOfItsOwn(entry: SecretsEntry): void {
  it('seals each value as one JWE under a data key of its own, which the current key wraps beside it under its kid', async () => {
    const database = await entry.aDatabase();
    const key = aSecretsKey();
    const store = await storeOn(entry, database, { current: key });

    const ids = await keptEach(store, ['first-key', 'second-key']);
    const rows = await rowsIn(entry, database);
    const dataKeys = await Promise.all(rows.map(({ wrapped_key }) => hexOfTheDataKey(key, wrapped_key)));
    const opened = await Promise.all(
      rows.map(async (row): Promise<readonly [string, string]> => [row.id, await openedWith(key, row)]),
    );

    expect(kidOf(key)).toMatch(/^[\da-f]{16}$/u);
    expect(rows.map(({ kept_by, kid }) => [kept_by, kid])).toEqual([
      ['ledger', kidOf(key)],
      ['ledger', kidOf(key)],
    ]);
    expect(rows.map(({ held }) => [held.split('.').length, decodeProtectedHeader(held)])).toEqual([
      [5, { alg: 'dir', enc: 'A256GCM' }],
      [5, { alg: 'dir', enc: 'A256GCM' }],
    ]);
    expect(rows.map(({ wrapped_key }) => decodeProtectedHeader(String(wrapped_key)))).toEqual([
      { alg: 'A256KW', enc: 'A256GCM' },
      { alg: 'A256KW', enc: 'A256GCM' },
    ]);
    expect(dataKeys.map((hex) => hex.length)).toEqual([64, 64]);
    expect(dataKeys[0]).not.toBe(dataKeys[1]);
    expect(new Map(opened)).toEqual(
      new Map([
        [ids[0], 'first-key'],
        [ids[1], 'second-key'],
      ]),
    );
  });
}

function unwrappedAtEachRead(entry: SecretsEntry): void {
  it('asks the custodian to wrap once for each value it keeps and to unwrap once for each read, keeping no data key and filling each with zeros once used', async () => {
    const database = await entry.aDatabase();
    const custodian = recordingCustodian();
    const store = await storeWith(entry, database, { current: custodian });

    const id = await kept(store, 'pasted-key');
    const reads = [await readBack(store, id), await readBack(store, id), await readBack(store, randomUUIDv7())];

    expect(reads).toEqual(['pasted-key', 'pasted-key', undefined]);
    expect({ wraps: custodian.wraps(), unwraps: custodian.unwraps() }).toEqual({ wraps: 1, unwraps: 2 });
    expect(custodian.dataKeys().map((dataKey) => dataKey.every((byte) => byte === 0))).toEqual([true, true, true]);
  });
}

function forgottenTwiceAsOnce(entry: SecretsEntry): void {
  it('answers nothing for an id it does not keep, and forgets a value, twice as once', async () => {
    const database = await entry.aDatabase();
    const store = await storeOn(entry, database, { current: aSecretsKey() });
    const id = await kept(store, 'pasted-key');

    await Effect.runPromise(Effect.andThen(store.forget(id), store.forget(id)));

    expect([await readBack(store, randomUUIDv7()), await readBack(store, id)]).toEqual([undefined, undefined]);
    expect(await rowsIn(entry, database)).toEqual([]);
  });
}

function unknownKeyRefused(entry: SecretsEntry): void {
  it('cannot read a value sealed under another key, and names that key and never the value', async () => {
    const database = await entry.aDatabase();
    const sealing = aSecretsKey();
    const id = await kept(await storeOn(entry, database, { current: sealing }), 'pasted-key');
    const other = await storeOn(entry, database, { current: aSecretsKey() });

    const refused = await Effect.runPromise(Effect.flip(other.read(id)));

    expect(refused).toMatchObject({
      _tag: 'secret_key_unknown',
      kid: kidOf(sealing),
      detail: `The secret is sealed under the key ${kidOf(sealing)}, which is neither the current key nor the previous one`,
    });
    expect(JSON.stringify(refused)).not.toContain('pasted-key');
  });
}

function valuesRefused(entry: SecretsEntry): void {
  it('refuses an empty value and one of more than 8 KiB of UTF-8 before anything is sealed, and keeps neither', async () => {
    const database = await entry.aDatabase();
    const custodian = recordingCustodian();
    const store = await storeWith(entry, database, { current: custodian });

    const refusals = await Effect.runPromise(
      Effect.forEach(['', 'x'.repeat(8193), 'é'.repeat(4097)], (value) =>
        Effect.flip(store.keep(Redacted.make(value))),
      ),
    );
    const wrapsBefore = custodian.wraps();
    const largest = await keptEach(store, ['x'.repeat(8192), 'é'.repeat(4096)]);

    expect(refusals).toEqual([
      expect.objectContaining({ _tag: 'secret_refused', because: 'empty', detail: 'A secret to keep is empty' }),
      expect.objectContaining({ because: 'too_large', detail: 'A secret to keep holds more than 8 KiB' }),
      expect.objectContaining({ because: 'too_large', detail: 'A secret to keep holds more than 8 KiB' }),
    ]);
    expect(wrapsBefore).toBe(0);
    expect(await Promise.all(largest.map((id) => readBack(store, id)))).toEqual(['x'.repeat(8192), 'é'.repeat(4096)]);
    expect(await rowsIn(entry, database)).toHaveLength(2);
  });
}

function custodianRefusing(entry: SecretsEntry): void {
  it('keeps nothing whose data key the custodian refuses to wrap, and reads nothing whose data key it refuses to unwrap', async () => {
    const database = await entry.aDatabase();
    const custodian = recordingCustodian();
    const store = await storeWith(entry, database, { current: custodian });
    const id = await kept(store, 'pasted-key');

    custodian.refuse();

    await expect(kept(store, 'second-key')).rejects.toThrow(custodianRefusal);
    await expect(readBack(store, id)).rejects.toThrow(custodianRefusal);
    expect((await rowsIn(entry, database)).map((row) => row.id)).toEqual([id]);
  });
}

function rewrappedInBatches(entry: SecretsEntry): void {
  it('reads with its previous key, and wraps again in batches under the current one the data keys the previous wrapped, touching no value', async () => {
    const database = await entry.aDatabase();
    const [previous, current, stray] = [aSecretsKey(), aSecretsKey(), aSecretsKey()];
    const values = Array.from({ length: 101 }, (_, index) => `pasted-key-${index}`);
    const ids = await keptEach(await storeOn(entry, database, { current: previous }), values);
    const strayId = await kept(await storeOn(entry, database, { current: stray }), 'stray-key');
    const rotating = await storeOn(entry, database, { current, previous });
    const before = (await rowsIn(entry, database)).map(({ held, kept_at, version }) => ({ held, kept_at, version }));

    const readBefore = await readBack(rotating, String(ids[0]));
    const rewrapped = await Effect.runPromise(rotating.rotated());
    const afterwards = await storeOn(entry, database, { current });

    expect({ readBefore, rewrapped }).toEqual({ readBefore: 'pasted-key-0', rewrapped: 101 });
    expect(await kidsIn(entry, database)).toEqual({ [kidOf(current)]: 101, [kidOf(stray)]: 1 });
    expect((await rowsIn(entry, database)).map(({ held, kept_at, version }) => ({ held, kept_at, version }))).toEqual(
      before,
    );
    expect(await Promise.all(ids.map((id) => readBack(afterwards, id)))).toEqual(values);
    expect(await Effect.runPromise(rotating.rotated())).toBe(0);
    expect(await Effect.runPromise(Effect.flip(rotating.read(strayId)))).toMatchObject({ kid: kidOf(stray) });
  });
}

function rewrappedNothing(entry: SecretsEntry): void {
  it('wraps nothing again without a previous key, or with the current key given as the previous one', async () => {
    const database = await entry.aDatabase();
    const key = aSecretsKey();
    const alone = await storeOn(entry, database, { current: key });
    const id = await kept(alone, 'pasted-key');
    const twice = await storeOn(entry, database, { current: key, previous: key });

    const rewrapped = [await Effect.runPromise(alone.rotated()), await Effect.runPromise(twice.rotated())];

    expect(rewrapped).toEqual([0, 0]);
    expect(await readBack(twice, id)).toBe('pasted-key');
  });
}

export function storeBehaviour(entry: SecretsEntry): void {
  describe('the secret store over the rows', () => {
    keptUnderAnIdOfItsOwn(entry);
    sealedUnderADataKeyOfItsOwn(entry);
    unwrappedAtEachRead(entry);
    forgottenTwiceAsOnce(entry);
    unknownKeyRefused(entry);
    valuesRefused(entry);
    custodianRefusing(entry);
    rewrappedInBatches(entry);
    rewrappedNothing(entry);
    storeLeaseBehaviour(entry);
  });
}
