import { DateTime, Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { localCustodian } from '../custodians/local-custodian.ts';
import type { Keeper } from '../keepers/keeper.ts';
import { sealedKeeper } from '../keepers/sealed-keeper.ts';
import type { Holding, SecretRows } from '../rows/secret-rows.ts';
import { memoryRows } from '../testing/memory-rows.ts';
import { custodianRefusal, recordingCustodian } from '../testing/recording-custodian.ts';
import { sealedSecretStoreOn } from './sealed-store.ts';
import { secretStoreOn, type SecretStore } from './secret-store.ts';

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

function custodianOf(byte: number) {
  return localCustodian(Redacted.make(new Uint8Array(32).fill(byte)));
}

function keeperInTheClear(released: (holding: Holding) => void): Keeper {
  return {
    name: 'in-the-clear',
    hold: (id, value) => Effect.succeed({ keptBy: 'in-the-clear', held: `${id}:${Redacted.value(value)}` }),
    reveal: ({ held }) => Effect.succeed(Redacted.make(held)),
    release: (holding) =>
      Effect.sync(() => {
        released(holding);
      }),
  };
}

async function stateOf(store: SecretStore, id: string) {
  const read = await Effect.runPromise(store.read(id));
  return read === undefined ? read : { value: Redacted.value(read.value), version: read.version };
}

describe('the secret store and its keeper', () => {
  it('hands its keeper the id it keeps a value under, and releases with it the holding of a row it forgets, and nothing for an id it does not keep', async () => {
    const released: Holding[] = [];
    const store = secretStoreOn(memoryRows({ now }), {
      current: keeperInTheClear((holding) => {
        released.push(holding);
      }),
    });

    const id = await Effect.runPromise(store.keep(Redacted.make('pasted-key')));
    const state = await stateOf(store, id);
    await Effect.runPromise(Effect.andThen(store.forget(id), store.forget(id)));

    expect(state).toEqual({ value: `${id}:pasted-key`, version: 1 });
    expect(released).toEqual([{ keptBy: 'in-the-clear', held: `${id}:pasted-key` }]);
  });
});

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

describe('the rotation of the secret store', () => {
  it('never writes over a replacement made between its read of a row and its write, which stays under the current key', async () => {
    const rows = memoryRows({ now });
    const [previous, current] = [custodianOf(5), custodianOf(6)];
    const before = sealedSecretStoreOn(rows, { current: previous });
    const ids = await Effect.runPromise(
      Effect.forEach(['first-tokens', 'second-key'], (value) => before.keep(Redacted.make(value))),
    );
    const [replacedId, untouchedId] = ids.toSorted();
    const valuesKept = new Map([
      [ids[0], 'first-tokens'],
      [ids[1], 'second-key'],
    ]);
    const replacing = sealedSecretStoreOn(rows, { current });
    const rotating = secretStoreOn(
      replacedBeforeItsFirstRehold(rows, (id) =>
        Effect.runPromise(replacing.replace(id, 1, Redacted.make('renewed-tokens'))),
      ),
      { current: sealedKeeper({ current, previous }) },
      { current, previous },
    );

    const rewrapped = await Effect.runPromise(rotating.rotated());

    expect(rewrapped).toBe(1);
    expect(rows.kept().map(({ kid }) => kid)).toEqual([current.kid, current.kid]);
    expect([await stateOf(rotating, String(replacedId)), await stateOf(rotating, String(untouchedId))]).toEqual([
      { value: 'renewed-tokens', version: 2 },
      { value: valuesKept.get(untouchedId), version: 1 },
    ]);
  });

  it('fills with zeros each data key it unwrapped with the previous key once the current key wrapped it again', async () => {
    const rows = memoryRows({ now });
    const [previous, current] = [recordingCustodian(), recordingCustodian()];
    const before = sealedSecretStoreOn(rows, { current: previous });
    const id = await Effect.runPromise(before.keep(Redacted.make('pasted-key')));
    const rotating = sealedSecretStoreOn(rows, { current, previous });

    const rewrapped = await Effect.runPromise(rotating.rotated());
    const unwrapped = previous.dataKeys().slice(1);

    expect(rewrapped).toBe(1);
    expect(unwrapped.map((dataKey) => dataKey.every((byte) => byte === 0))).toEqual([true]);
    expect(current.dataKeys().at(0)).toBe(unwrapped.at(0));
    expect(await stateOf(rotating, id)).toEqual({ value: 'pasted-key', version: 1 });
  });
});

describe('a rotation whose previous custodian refuses', () => {
  it('fails with the refusal of the custodian in its words, holding nothing again', async () => {
    const rows = memoryRows({ now });
    const [previous, current] = [recordingCustodian(), recordingCustodian()];
    const before = sealedSecretStoreOn(rows, { current: previous });
    await Effect.runPromise(before.keep(Redacted.make('pasted-key')));
    const rotating = sealedSecretStoreOn(rows, { current, previous });

    previous.refuse();

    const refused = await Effect.runPromise(Effect.flip(rotating.rotated()));

    expect(refused).toMatchObject({
      _tag: 'custodian_refused',
      kid: previous.kid,
      detail: `The custodian of the key ${previous.kid} refused to unwrap a data key: ${custodianRefusal}`,
    });
    expect(rows.kept().map(({ kid }) => kid)).toEqual([previous.kid]);
  });
});
