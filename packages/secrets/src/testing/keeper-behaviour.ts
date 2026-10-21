import { Effect, Logger, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { inMemoryKeepers, type TestKeepers } from '../fakes/memory-keeper.ts';
import type { Keeper } from '../keepers/keeper.ts';
import { sealedKeeper } from '../keepers/sealed-keeper.ts';
import type { Holding } from '../rows/secret-rows.ts';
import { keeperMoveBehaviour } from './move-behaviour.ts';
import { recordingCustodian } from './recording-custodian.ts';
import {
  at,
  firstMoment,
  holdingOf,
  isoOf,
  kept,
  keptEach,
  readBack,
  rowsIn,
  storeKeptBy,
  type SecretsEntry,
} from './secrets-entry.ts';

async function revealedBy(keeper: Keeper, holding: Holding): Promise<string | undefined> {
  const value = await Effect.runPromise(keeper.reveal(holding));
  return value === undefined ? undefined : Redacted.value(value);
}

function keptAsItIs(entry: SecretsEntry, keepers: TestKeepers): void {
  it('keeps a value as it is in the keeper under the id of its row, whose holding says where and holds no value, and reads it back redacted', async () => {
    const database = await entry.aDatabase();
    const keeper = await keepers.aKeeper();
    const store = await storeKeptBy(entry, database, { current: keeper });

    const id = await at(firstMoment, store.keep(Redacted.make('pasted-key'), '-key'));
    const read = await Effect.runPromise(store.read(id));
    const [row] = await rowsIn(entry, database);

    expect(JSON.stringify({ read })).toBe('{"read":{"value":"<redacted>","version":1}}');
    expect(await readBack(store, id)).toBe('pasted-key');
    expect(row).toMatchObject({
      id,
      version: 1,
      kept_at: isoOf(firstMoment),
      ends_with: '-key',
      kept_by: keeper.name,
      wrapped_key: null,
      kid: null,
    });
    expect([row?.held.includes(id), row?.held.includes('pasted-key')]).toEqual([true, false]);
    expect(await keepers.valueIn(holdingOf(row))).toBe('pasted-key');
  });
}

function replacedAtTheNextVersion(entry: SecretsEntry, keepers: TestKeepers): void {
  it('replaces a value at the next version of its row, while the keeper still reveals the version the row named before', async () => {
    const database = await entry.aDatabase();
    const keeper = await keepers.aKeeper();
    const store = await storeKeptBy(entry, database, { current: keeper });
    const id = await kept(store, 'first-tokens');
    const [before] = await rowsIn(entry, database);

    const replaced = await Effect.runPromise(store.replace(id, 1, Redacted.make('second-tokens')));
    const [after] = await rowsIn(entry, database);

    expect(replaced).toEqual({ replaced: true, version: 2 });
    expect(await readBack(store, id)).toBe('second-tokens');
    expect(after?.held).not.toBe(before?.held);
    expect(await revealedBy(keeper, holdingOf(before))).toBe('first-tokens');
    expect(await keepers.valueIn(holdingOf(after))).toBe('second-tokens');
  });
}

function forgottenWithEveryVersion(entry: SecretsEntry, keepers: TestKeepers): void {
  it('forgets a value twice as once, after which the keeper holds none of its versions', async () => {
    const database = await entry.aDatabase();
    const keeper = await keepers.aKeeper();
    const store = await storeKeptBy(entry, database, { current: keeper });
    const id = await kept(store, 'first-tokens');
    const [first] = await rowsIn(entry, database);
    await Effect.runPromise(store.replace(id, 1, Redacted.make('second-tokens')));
    const [second] = await rowsIn(entry, database);

    await Effect.runPromise(Effect.andThen(store.forget(id), store.forget(id)));

    expect(await readBack(store, id)).toBeUndefined();
    expect(await rowsIn(entry, database)).toEqual([]);
    expect([await keepers.valueIn(holdingOf(first)), await keepers.valueIn(holdingOf(second))]).toEqual([
      undefined,
      undefined,
    ]);
    expect(await revealedBy(keeper, holdingOf(second))).toBeUndefined();
  });
}

function countingHolds(keeper: Keeper): { readonly keeper: Keeper; readonly holds: () => number } {
  const asked = { holds: 0 };
  return {
    keeper: {
      ...keeper,
      hold: (id, value) =>
        Effect.suspend(() => {
          asked.holds += 1;
          return keeper.hold(id, value);
        }),
    },
    holds: () => asked.holds,
  };
}

function refusedBeforeTheKeeperIsAsked(entry: SecretsEntry, keepers: TestKeepers): void {
  it('refuses an empty value and one of more than 8 KiB of UTF-8 before the keeper is asked, and keeps the largest it may', async () => {
    const database = await entry.aDatabase();
    const counted = countingHolds(await keepers.aKeeper());
    const store = await storeKeptBy(entry, database, { current: counted.keeper });

    const refusals = await Effect.runPromise(
      Effect.forEach(['', 'x'.repeat(8193), 'é'.repeat(4097)], (value) =>
        Effect.flip(store.keep(Redacted.make(value))),
      ),
    );
    const holdsBefore = counted.holds();
    const largest = await keptEach(store, ['x'.repeat(8192), 'é'.repeat(4096)]);

    expect(refusals.map((refusal: { readonly detail: string }) => refusal.detail)).toEqual([
      'A secret to keep is empty',
      'A secret to keep holds more than 8 KiB',
      'A secret to keep holds more than 8 KiB',
    ]);
    expect(holdsBefore).toBe(0);
    expect(await Promise.all(largest.map((id) => readBack(store, id)))).toEqual(['x'.repeat(8192), 'é'.repeat(4096)]);
  });
}

async function loggedWhile<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<{ readonly answer: A; readonly logged: string }> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const answer = await Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([capture]))));
  return { answer, logged: lines.join('\n') };
}

function strayKidsLeft(entry: SecretsEntry, keepers: TestKeepers): void {
  it('leaves where they are the rows sealed under a key neither custodian holds, logged once with its kid, moves the rest, and moves those rows once their key is given as the previous one', async () => {
    const database = await entry.aDatabase();
    const [keeper, stray, custodian] = [await keepers.aKeeper(), recordingCustodian(), recordingCustodian()];
    await keptEach(await storeKeptBy(entry, database, { current: sealedKeeper({ current: stray }) }), [
      'first',
      'second',
    ]);
    const [id] = await keptEach(await storeKeptBy(entry, database, { current: sealedKeeper({ current: custodian }) }), [
      'third',
    ]);
    const there = await storeKeptBy(
      entry,
      database,
      { current: keeper, previous: sealedKeeper({ current: custodian }) },
      { current: custodian },
    );

    const { answer, logged } = await loggedWhile(there.moved());
    const rows = await rowsIn(entry, database);
    const given = await storeKeptBy(
      entry,
      database,
      { current: keeper, previous: sealedKeeper({ current: custodian, previous: stray }) },
      { current: custodian, previous: stray },
    );

    expect(answer).toBe(1);
    expect(rows.map(({ kept_by, kid }) => `${kept_by} ${String(kid)}`).toSorted()).toEqual(
      [`${keeper.name} null`, `ledger ${stray.kid}`, `ledger ${stray.kid}`].toSorted(),
    );
    expect(await readBack(there, String(id))).toBe('third');
    expect(logged.split('\n').filter((line) => line.includes('unmoved'))).toEqual([
      expect.stringContaining(
        `Secrets are left with the previous keeper, unmoved, until their key is given: The secret is sealed under the key ${stray.kid}, which is neither the current key nor the previous one`,
      ),
    ]);
    expect(logged).not.toMatch(/first|second|third/u);
    expect(await Effect.runPromise(given.moved())).toBe(2);
  });
}

export function keeperBehaviour(entry: SecretsEntry, keepers: TestKeepers = inMemoryKeepers()): void {
  describe('the secret store over a keeper other than the ledger', () => {
    keptAsItIs(entry, keepers);
    replacedAtTheNextVersion(entry, keepers);
    forgottenWithEveryVersion(entry, keepers);
    refusedBeforeTheKeeperIsAsked(entry, keepers);
    keeperMoveBehaviour(entry, keepers);
    strayKidsLeft(entry, keepers);
  });
}
