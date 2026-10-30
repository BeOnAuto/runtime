import { randomUUIDv7 } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';
import { compactDecrypt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import type { Custodian } from '../custodians/custodian.ts';
import { storeFailureBehaviour } from './failure-behaviour.ts';
import { keeperBehaviour } from './keeper-behaviour.ts';
import { storeLeaseBehaviour } from './lease-behaviour.ts';
import { recordingCustodian } from './recording-custodian.ts';
import {
  at,
  firstMoment,
  isoOf,
  kept,
  keptEach,
  kidsIn,
  localCustodians,
  readBack,
  rowsIn,
  storeWith,
  type SecretsEntry,
  type TestCustodians,
} from './secrets-entry.ts';

const uuidV7 = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

interface Wrapped {
  readonly held: string;
  readonly wrapped_key: string | null;
}

async function hexOfTheDataKey(custodian: Custodian, { wrapped_key }: Wrapped): Promise<string> {
  return Buffer.from(Redacted.value(await Effect.runPromise(custodian.unwrap(String(wrapped_key))))).toString('hex');
}

async function openedWith(custodian: Custodian, row: Wrapped): Promise<string> {
  const { plaintext } = await compactDecrypt(row.held, Buffer.from(await hexOfTheDataKey(custodian, row), 'hex'));
  return new TextDecoder().decode(plaintext);
}

function holdsInTheClear({ wrapped_key }: Wrapped, hex: string): boolean {
  const dataKey = Buffer.from(hex, 'hex');
  const wrapping = String(wrapped_key);
  const written = [dataKey.toString('base64'), dataKey.toString('base64url'), dataKey.toString('hex')];
  return written.some((form) => wrapping.includes(form)) || Buffer.from(wrapping, 'base64').includes(dataKey);
}

function keptUnderAnIdOfItsOwn(entry: SecretsEntry, custodians: TestCustodians): void {
  it('keeps a value under an id of its own, a UUIDv7, at its first version with the ending it is given, and reads it back redacted', async () => {
    const database = await entry.aDatabase();
    const store = await storeWith(entry, database, { current: await custodians.aCustodian() });

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

function sealedUnderADataKeyOfItsOwn(entry: SecretsEntry, custodians: TestCustodians): void {
  it('seals each value as one JWE under a data key of its own, which the current custodian wraps beside it under its kid and never holds in the clear', async () => {
    const database = await entry.aDatabase();
    const custodian = await custodians.aCustodian();
    const store = await storeWith(entry, database, { current: custodian });

    const ids = await keptEach(store, ['first-key', 'second-key']);
    const rows = await rowsIn(entry, database);
    const dataKeys = await Promise.all(rows.map((row) => hexOfTheDataKey(custodian, row)));
    const inTheClear = await Promise.all(
      rows.map(async (row) => holdsInTheClear(row, await hexOfTheDataKey(custodian, row))),
    );
    const opened = await Promise.all(
      rows.map(async (row): Promise<readonly [string, string]> => [row.id, await openedWith(custodian, row)]),
    );

    expect(rows.map(({ kept_by, kid }) => [kept_by, kid])).toEqual([
      ['ledger', custodian.kid],
      ['ledger', custodian.kid],
    ]);
    expect(rows.map(({ held }) => [held.split('.').length, decodeProtectedHeader(held)])).toEqual([
      [5, { alg: 'dir', enc: 'A256GCM' }],
      [5, { alg: 'dir', enc: 'A256GCM' }],
    ]);
    expect(dataKeys.map((hex) => hex.length)).toEqual([64, 64]);
    expect(new Set(dataKeys).size).toBe(2);
    expect(inTheClear).toEqual([false, false]);
    expect(new Map(opened)).toEqual(
      new Map([
        [ids[0], 'first-key'],
        [ids[1], 'second-key'],
      ]),
    );
  });
}

function unwrappedAtEachRead(entry: SecretsEntry, custodians: TestCustodians): void {
  it('asks the custodian to wrap once for each value it keeps and to unwrap once for each read, keeping no data key and filling each with zeros once used', async () => {
    const database = await entry.aDatabase();
    const custodian = recordingCustodian(await custodians.aCustodian());
    const store = await storeWith(entry, database, { current: custodian });

    const id = await kept(store, 'pasted-key');
    const reads = [await readBack(store, id), await readBack(store, id), await readBack(store, randomUUIDv7())];

    expect(reads).toEqual(['pasted-key', 'pasted-key', undefined]);
    expect({ wraps: custodian.wraps(), unwraps: custodian.unwraps() }).toEqual({ wraps: 1, unwraps: 2 });
    expect(custodian.dataKeys().map((dataKey) => dataKey.every((byte) => byte === 0))).toEqual([true, true, true]);
  });
}

function forgottenTwiceAsOnce(entry: SecretsEntry, custodians: TestCustodians): void {
  it('answers nothing for an id it does not keep, and forgets a value, twice as once', async () => {
    const database = await entry.aDatabase();
    const store = await storeWith(entry, database, { current: await custodians.aCustodian() });
    const id = await kept(store, 'pasted-key');

    await Effect.runPromise(Effect.andThen(store.forget(id), store.forget(id)));

    expect([await readBack(store, randomUUIDv7()), await readBack(store, id)]).toEqual([undefined, undefined]);
    expect(await rowsIn(entry, database)).toEqual([]);
  });
}

function valuesRefused(entry: SecretsEntry, custodians: TestCustodians): void {
  it('refuses an empty value and one of more than 8 KiB of UTF-8 before anything is sealed, and keeps neither', async () => {
    const database = await entry.aDatabase();
    const custodian = recordingCustodian(await custodians.aCustodian());
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

async function threeOf(custodians: TestCustodians): Promise<readonly [Custodian, Custodian, Custodian]> {
  return [await custodians.aCustodian(), await custodians.aCustodian(), await custodians.aCustodian()];
}

function rewrappedInBatches(entry: SecretsEntry, custodians: TestCustodians): void {
  it('reads with its previous custodian, and wraps again in batches under the current one the data keys the previous wrapped, touching no value', async () => {
    const database = await entry.aDatabase();
    const [previous, current, stray] = await threeOf(custodians);
    const values = Array.from({ length: 101 }, (_, index) => `pasted-key-${index}`);
    const ids = await keptEach(await storeWith(entry, database, { current: previous }), values);
    const strayId = await kept(await storeWith(entry, database, { current: stray }), 'stray-key');
    const rotating = await storeWith(entry, database, { current, previous });
    const before = (await rowsIn(entry, database)).map(({ held, kept_at, version }) => ({ held, kept_at, version }));

    const readBefore = await readBack(rotating, String(ids[0]));
    const rewrapped = await Effect.runPromise(rotating.rotated());
    const afterwards = await storeWith(entry, database, { current });

    expect({ readBefore, rewrapped }).toEqual({ readBefore: 'pasted-key-0', rewrapped: 101 });
    expect(await kidsIn(entry, database)).toEqual({ [current.kid]: 101, [stray.kid]: 1 });
    expect((await rowsIn(entry, database)).map(({ held, kept_at, version }) => ({ held, kept_at, version }))).toEqual(
      before,
    );
    expect(await Promise.all(ids.map((id) => readBack(afterwards, id)))).toEqual(values);
    expect(await Effect.runPromise(rotating.rotated())).toBe(0);
    expect(await Effect.runPromise(Effect.flip(rotating.read(strayId)))).toMatchObject({ kid: stray.kid });
  });
}

function rewrappedNothing(entry: SecretsEntry, custodians: TestCustodians): void {
  it('wraps nothing again without a previous custodian, or with the current one given as the previous one', async () => {
    const database = await entry.aDatabase();
    const custodian = await custodians.aCustodian();
    const alone = await storeWith(entry, database, { current: custodian });
    const id = await kept(alone, 'pasted-key');
    const twice = await storeWith(entry, database, { current: custodian, previous: custodian });

    const rewrapped = [await Effect.runPromise(alone.rotated()), await Effect.runPromise(twice.rotated())];

    expect(rewrapped).toEqual([0, 0]);
    expect(await readBack(twice, id)).toBe('pasted-key');
  });
}

export function storeBehaviour(entry: SecretsEntry, custodians: TestCustodians = localCustodians): void {
  describe('the secret store over the rows', () => {
    keptUnderAnIdOfItsOwn(entry, custodians);
    sealedUnderADataKeyOfItsOwn(entry, custodians);
    unwrappedAtEachRead(entry, custodians);
    forgottenTwiceAsOnce(entry, custodians);
    valuesRefused(entry, custodians);
    rewrappedInBatches(entry, custodians);
    rewrappedNothing(entry, custodians);
    storeFailureBehaviour(entry, custodians);
    storeLeaseBehaviour(entry, custodians);
    keeperBehaviour(entry);
  });
}
