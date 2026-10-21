import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import type { TestKeepers } from '../fakes/memory-keeper.ts';
import type { Keeper } from '../keepers/keeper.ts';
import { sealedKeeper } from '../keepers/sealed-keeper.ts';
import type { Holding, SecretRows } from '../rows/secret-rows.ts';
import { secretStoreOn, type SecretStore } from '../store/secret-store.ts';
import { heldElsewhere } from './holdings.ts';
import { custodianRefusal, recordingCustodian, type RecordingCustodian } from './recording-custodian.ts';
import {
  aLease,
  at,
  firstMoment,
  holdingOf,
  isoOf,
  kept,
  keptEach,
  readBack,
  rowsIn,
  rowsOpenedOn,
  storeKeptBy,
  type SecretsEntry,
} from './secrets-entry.ts';

interface KeptRow {
  readonly id: string;
  readonly kept_by: string;
  readonly held: string;
  readonly wrapped_key: string | null;
  readonly kid: string | null;
}

function aSealingKeeper(custodian: RecordingCustodian): Keeper {
  return sealedKeeper({ current: custodian });
}

function sealedHoldingOf(row: KeptRow): Holding {
  return { ...holdingOf(row), wrappedKey: String(row.wrapped_key), kid: String(row.kid) };
}

function whereKept({ kept_by, wrapped_key, kid }: KeptRow): string {
  return JSON.stringify([kept_by, wrapped_key === null, kid]);
}

interface Bookkeeping {
  readonly id: string;
  readonly version: number;
  readonly kept_at: string;
  readonly claimed_until: string | null;
  readonly ends_with: string | null;
}

async function bookkeepingIn(entry: SecretsEntry, database: string): Promise<readonly Bookkeeping[]> {
  return (await rowsIn(entry, database)).map(({ id, version, kept_at, claimed_until, ends_with }): Bookkeeping => ({
    id,
    version,
    kept_at,
    claimed_until,
    ends_with,
  }));
}

async function keptSealed(
  entry: SecretsEntry,
  database: string,
  custodian: RecordingCustodian,
  values: readonly string[],
) {
  const store = await storeKeptBy(entry, database, { current: aSealingKeeper(custodian) }, { current: custodian });
  const ids = await keptEach(store, values);
  await at(firstMoment, store.claim(String(ids[0]), 1, aLease));
  return ids;
}

function valuesIn(keepers: TestKeepers, rows: readonly KeptRow[]): Promise<readonly (string | undefined)[]> {
  return Promise.all(rows.map((row) => keepers.valueIn(holdingOf(row))));
}

function movedThereAndBack(entry: SecretsEntry, keepers: TestKeepers): void {
  it('moves into the keeper named beside the ledger every value the ledger seals, more than a hundred, and back, each row keeping its version, its claim, its ending and when it was kept', async () => {
    const database = await entry.aDatabase();
    const [keeper, custodian] = [await keepers.aKeeper(), recordingCustodian()];
    const sealing = aSealingKeeper(custodian);
    const values = Array.from({ length: 101 }, (_, index) => `pasted-key-${index}`);
    const ids = await keptSealed(entry, database, custodian, values);
    const before = await bookkeepingIn(entry, database);
    const there = await storeKeptBy(entry, database, { current: keeper, previous: sealing }, { current: custodian });
    const back = await storeKeptBy(entry, database, { current: sealing, previous: keeper }, { current: custodian });

    const moved = await Effect.runPromise(there.moved());
    const rowsThere = await rowsIn(entry, database);
    const valuesThere = await valuesIn(keepers, rowsThere);
    const movedBack = await Effect.runPromise(back.moved());

    expect([moved, movedBack]).toEqual([101, 101]);
    expect(new Set(rowsThere.map((row) => whereKept(row)))).toEqual(
      new Set([JSON.stringify([keeper.name, true, null])]),
    );
    expect(rowsThere.filter(({ held }) => values.some((value) => held.includes(value)))).toEqual([]);
    expect(new Map(rowsThere.map(({ id }, index) => [id, valuesThere[index]]))).toEqual(
      new Map(ids.map((id, index) => [id, values[index]])),
    );
    expect(new Set((await rowsIn(entry, database)).map((row) => whereKept(row)))).toEqual(
      new Set([JSON.stringify(['ledger', false, custodian.kid])]),
    );
    expect(await Promise.all(ids.map((id) => readBack(back, id)))).toEqual(values);
    expect(new Set(await valuesIn(keepers, rowsThere))).toEqual(new Set([undefined]));
    expect(await bookkeepingIn(entry, database)).toEqual(before);
    expect(before.find(({ id }) => id === ids[0])?.claimed_until).toBe(isoOf(firstMoment + aLease));
    expect(await Effect.runPromise(back.moved())).toBe(0);
  });
}

function releasesRecordedOf(keeper: Keeper, recorded: (holding: Holding) => void): Keeper {
  return {
    ...keeper,
    release: (holding) =>
      Effect.andThen(
        keeper.release(holding),
        Effect.sync(() => {
          recorded(holding);
        }),
      ),
  };
}

function replacedBeforeItsFirstRehold(rows: SecretRows, replace: (id: string) => Promise<unknown>): SecretRows {
  const replaced: string[] = [];
  return {
    ...rows,
    reheld: (read, holding) =>
      Effect.andThen(
        Effect.promise(async () => {
          if (replaced.length === 0) {
            replaced.push(read.id);
            await replace(read.id);
          }
        }),
        rows.reheld(read, holding),
      ),
  };
}

interface Moving {
  readonly current: Keeper;
  readonly previous: Keeper;
  readonly replacing: (id: string) => Promise<unknown>;
}

async function movingWhileReplaced(entry: SecretsEntry, database: string, moving: Moving): Promise<SecretStore> {
  const rows = replacedBeforeItsFirstRehold(await rowsOpenedOn(entry, database), moving.replacing);
  return secretStoreOn(rows, { current: moving.current, previous: moving.previous });
}

function replacementLeftAlone(entry: SecretsEntry, keepers: TestKeepers): void {
  it('never writes over a replacement made between its read of a row and its write, either way, and releases nothing of that row', async () => {
    const database = await entry.aDatabase();
    const [keeper, custodian] = [await keepers.aKeeper(), recordingCustodian()];
    const released: Holding[] = [];
    const sealing = releasesRecordedOf(aSealingKeeper(custodian), (holding) => {
      released.push(holding);
    });
    const ids = await keptSealed(entry, database, custodian, ['first', 'second']);
    const [replacedId, movedId] = ids.toSorted();
    const sealedBefore = await rowsIn(entry, database);
    const replacing = await storeKeptBy(entry, database, { current: keeper });

    const there = await movingWhileReplaced(entry, database, {
      current: keeper,
      previous: sealing,
      replacing: (id) => Effect.runPromise(replacing.replace(id, 1, Redacted.make('renewed-tokens'))),
    });
    const moved = await Effect.runPromise(there.moved());
    const back = await movingWhileReplaced(entry, database, {
      current: sealing,
      previous: keeper,
      replacing: (id) => Effect.runPromise(replacing.replace(id, 2, Redacted.make('renewed-again'))),
    });
    const movedBack = await Effect.runPromise(back.moved());
    const rows = await rowsIn(entry, database);

    expect([moved, movedBack]).toEqual([1, 1]);
    expect(rows.map(({ id, version, kept_by }) => [id, version, kept_by])).toEqual([
      [replacedId, 3, keeper.name],
      [movedId, 1, 'ledger'],
    ]);
    expect([await readBack(back, String(replacedId)), await readBack(back, String(movedId))]).toEqual([
      'renewed-again',
      ['first', 'second'][ids.indexOf(String(movedId))],
    ]);
    expect(await keepers.valueIn(holdingOf(rows[0]))).toBe('renewed-again');
    expect(released).toEqual(sealedBefore.filter(({ id }) => id === movedId).map((row) => sealedHoldingOf(row)));
  });
}

function goneLeftWhereItIs(entry: SecretsEntry, keepers: TestKeepers): void {
  it('leaves a row whose value its keeper no longer holds where it is, read as gone while that keeper is named and unreadable now once it is not, and moves the rest past a hundred such rows', async () => {
    const database = await entry.aDatabase();
    const [keeper, custodian] = [await keepers.aKeeper(), recordingCustodian()];
    const values = Array.from({ length: 101 }, (_, index) => `pasted-key-${index}`);
    const ids = await keptEach(await storeKeptBy(entry, database, { current: keeper }), values);
    const valueOfId = new Map(ids.map((id, index) => [id, values[index]]));
    const rowsBefore = await rowsIn(entry, database);
    await Promise.all(rowsBefore.slice(0, 100).map((row) => keepers.lose(holdingOf(row))));
    const [lost, left] = [String(rowsBefore.at(0)?.id), String(rowsBefore.at(-1)?.id)];
    const sealing = aSealingKeeper(custodian);
    const back = await storeKeptBy(entry, database, { current: sealing, previous: keeper }, { current: custodian });

    const moved = await Effect.runPromise(back.moved());
    const readWhileNamed = await readBack(back, lost);
    const alone = await storeKeptBy(entry, database, { current: sealing }, { current: custodian });
    const unreadable = await Effect.runPromise(Effect.flip(alone.read(lost)));

    expect(moved).toBe(1);
    expect((await rowsIn(entry, database)).map(({ kept_by }) => kept_by)).toEqual([
      ...Array.from({ length: 100 }, () => keeper.name),
      'ledger',
    ]);
    expect(readWhileNamed).toBeUndefined();
    expect(await readBack(alone, left)).toBe(valueOfId.get(left));
    expect(unreadable).toMatchObject({
      _tag: 'keeper_unavailable',
      detail: `The secret is kept by the keeper ${keeper.name}, which is neither the current keeper nor the previous one`,
    });
  });
}

function movedNothing(entry: SecretsEntry, keepers: TestKeepers): void {
  it('moves nothing without a previous keeper, or with the current one given as the previous one, and leaves alone the rows of any other keeper', async () => {
    const database = await entry.aDatabase();
    const keeper = await keepers.aKeeper();
    const rows = await rowsOpenedOn(entry, database);
    await Effect.runPromise(rows.keep('secret-4', heldElsewhere));
    const id = await kept(await storeKeptBy(entry, database, { current: keeper }), 'pasted-key');

    const moved = await Effect.runPromise(
      Effect.all([
        secretStoreOn(rows, { current: keeper }).moved(),
        secretStoreOn(rows, { current: keeper, previous: keeper }).moved(),
      ]),
    );

    expect(moved).toEqual([0, 0]);
    expect((await rowsIn(entry, database)).map(({ kept_by }) => kept_by).toSorted()).toEqual(
      [keeper.name, heldElsewhere.keptBy].toSorted(),
    );
    expect(await readBack(secretStoreOn(rows, { current: keeper }), id)).toBe('pasted-key');
  });
}

function moveRefused(entry: SecretsEntry, keepers: TestKeepers): void {
  it('fails to move a value the previous keeper cannot reveal, in its words, and leaves every row as it was', async () => {
    const database = await entry.aDatabase();
    const [keeper, custodian] = [await keepers.aKeeper(), recordingCustodian()];
    await keptSealed(entry, database, custodian, ['first', 'second']);
    const before = await rowsIn(entry, database);
    const there = await storeKeptBy(
      entry,
      database,
      { current: keeper, previous: aSealingKeeper(custodian) },
      { current: custodian },
    );
    custodian.refuse();

    const refused = await Effect.runPromise(Effect.flip(there.moved()));

    expect(refused).toMatchObject({
      _tag: 'custodian_refused',
      detail: `The custodian of the key ${custodian.kid} refused to unwrap a data key: ${custodianRefusal}`,
    });
    expect(await rowsIn(entry, database)).toEqual(before);
  });
}

export function keeperMoveBehaviour(entry: SecretsEntry, keepers: TestKeepers): void {
  describe('a move between the ledger and that keeper', () => {
    movedThereAndBack(entry, keepers);
    replacementLeftAlone(entry, keepers);
    goneLeftWhereItIs(entry, keepers);
    movedNothing(entry, keepers);
    moveRefused(entry, keepers);
  });
}
