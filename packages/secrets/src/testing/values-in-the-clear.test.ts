import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { valuesInTheClear, type ValueInTheClear } from './values-in-the-clear.ts';

function valuesAt(now: () => number) {
  return valuesInTheClear({ now: Effect.sync(now), mostCharacters: 16 });
}

function revealed(read: ValueInTheClear | undefined) {
  return read === undefined ? read : { ...read, value: Redacted.value(read.value) };
}

const refusedAsTooLarge = { detail: 'A secret to keep holds more than 16 characters' };

describe('the values a test keeps in the clear in memory', () => {
  it('keep a value with its ending under the id they are given, refuse one past their bound, and forget a row', async () => {
    const values = valuesAt(() => 0);

    await Effect.runPromise(values.keep('secret-1', Redacted.make('first-tokens'), 'kens'));
    const refused = await Effect.runPromise(
      Effect.flip(values.keep('secret-2', Redacted.make('tokens past the bound'))),
    );
    const kept = { values: values.values(), endings: values.endings() };
    const endingsOf = await Effect.runPromise(values.endingsOf(['secret-1', 'secret-2']));
    await Effect.runPromise(values.forget('secret-1'));

    expect(refused).toEqual(refusedAsTooLarge);
    expect(kept).toEqual({
      values: new Map([['secret-1', 'first-tokens']]),
      endings: new Map([['secret-1', 'kens']]),
    });
    expect(endingsOf).toEqual(new Map([['secret-1', 'kens']]));
    expect([await Effect.runPromise(values.read('secret-1')), values.values()]).toEqual([undefined, new Map()]);
  });

  it('claim and replace a value under the version read, ending its claim, and refuse a replacement past their bound', async () => {
    const values = valuesAt(() => 0);
    await Effect.runPromise(values.keep('secret-1', Redacted.make('first-tokens')));

    const claim = await Effect.runPromise(values.claim('secret-1', 1, 1000));
    const whileClaimed = await Effect.runPromise(values.read('secret-1'));
    const replaced = await Effect.runPromise(values.replace('secret-1', 1, Redacted.make('second-tokens')));
    const refused = await Effect.runPromise(
      Effect.flip(values.replace('secret-1', 2, Redacted.make('tokens past the bound'))),
    );
    const read = await Effect.runPromise(values.read('secret-1'));

    expect(values.endings()).toEqual(new Map());
    expect({ claim, claimedUntil: whileClaimed?.claimedUntil, replaced, refused }).toEqual({
      claim: { claimed: true, until: '1970-01-01T00:00:01.000Z' },
      claimedUntil: '1970-01-01T00:00:01.000Z',
      replaced: { replaced: true, version: 2 },
      refused: refusedAsTooLarge,
    });
    expect(revealed(read)).toEqual({
      value: 'second-tokens',
      version: 2,
      claimedUntil: undefined,
    });
  });
});
