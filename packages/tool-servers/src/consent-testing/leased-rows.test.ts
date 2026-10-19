import { Effect, Option, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { leasedRows } from './leased-rows.ts';

function rowsAt(now: () => number) {
  return leasedRows({ now: Effect.sync(now), mostCharacters: 16 });
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(Effect.result(effect));

describe('the rows a test keeps in memory', () => {
  it('keep a value under an id of their own, refuse one past their bound, and forget a row', () => {
    const rows = rowsAt(() => 0);

    const kept = run(rows.keep(Redacted.make('first-tokens')));
    const refused = run(rows.keep(Redacted.make('tokens past the bound')));
    const values = rows.values();
    Effect.runSync(rows.forget('secret-1'));

    expect([kept, refused]).toMatchObject([
      { _tag: 'Success', success: 'secret-1' },
      { _tag: 'Failure', failure: { detail: 'A secret to keep holds more than 16 characters' } },
    ]);
    expect(values).toEqual(new Map([['secret-1', 'first-tokens']]));
    expect(Effect.runSync(rows.read('secret-1'))).toBeUndefined();
  });
});

describe('the claims and replacements of the rows a test keeps in memory', () => {
  it('claim a row of the version read while no claim is open, which a read answers until it ends', () => {
    const moment = { now: 0 };
    const rows = rowsAt(() => moment.now);
    Effect.runSync(rows.keep(Redacted.make('first-tokens')));

    const claims = [
      Effect.runSync(rows.claim('secret-1', 2, 1000)),
      Effect.runSync(rows.claim('secret-1', 1, 1000)),
      Effect.runSync(rows.claim('secret-1', 1, 1000)),
    ];
    const whileClaimed = Effect.runSync(rows.read('secret-1'));
    moment.now = 1000;
    const afterTheClaim = Effect.runSync(rows.read('secret-1'));

    expect(claims).toEqual([
      { claimed: false },
      { claimed: true, until: '1970-01-01T00:00:01.000Z' },
      { claimed: false },
    ]);
    expect([whileClaimed?.claimedUntil, afterTheClaim?.claimedUntil]).toEqual(['1970-01-01T00:00:01.000Z', undefined]);
  });

  it('replace the value of a row under the version read, ending its claim, and refuse one past their bound', () => {
    const rows = rowsAt(() => 0);
    Effect.runSync(rows.keep(Redacted.make('first-tokens')));
    Effect.runSync(rows.claim('secret-1', 1, 1000));

    const replaced = run(rows.replace('secret-1', 1, Redacted.make('second-tokens')));
    const moved = run(rows.replace('secret-1', 1, Redacted.make('third-tokens')));
    const refused = run(rows.replace('secret-1', 2, Redacted.make('tokens past the bound')));
    const read = Option.getOrThrow(Option.fromNullishOr(Effect.runSync(rows.read('secret-1'))));

    expect([replaced, moved, refused]).toMatchObject([
      { success: { replaced: true, version: 2 } },
      { success: { replaced: false } },
      { failure: { detail: 'A secret to keep holds more than 16 characters' } },
    ]);
    expect({ ...read, value: Redacted.value(read.value) }).toEqual({
      value: 'second-tokens',
      version: 2,
      claimedUntil: undefined,
    });
  });
});
