import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { localCustodian } from '../custodians/local-custodian.ts';
import { recordingCustodian } from '../testing/recording-custodian.ts';
import { sealedKeeper } from './sealed-keeper.ts';

function custodianOf(byte: number) {
  return localCustodian(Redacted.make(new Uint8Array(32).fill(byte)));
}

const previous = custodianOf(5);

const current = custodianOf(6);

function revealed(value: Redacted.Redacted | undefined): string | undefined {
  return value === undefined ? undefined : Redacted.value(value);
}

describe("the ledger's keeper", () => {
  it('seals a value under the current custodian, names no id in what it holds, and reveals it under the custodian its kid names', async () => {
    const before = sealedKeeper({ current: previous });
    const after = sealedKeeper({ current, previous });

    const holding = await Effect.runPromise(before.hold('secret-1', Redacted.make('pasted-key')));
    const holdingNow = await Effect.runPromise(after.hold('secret-1', Redacted.make('pasted-key')));

    expect([before.name, holding.keptBy, holding.kid, holdingNow.kid]).toEqual([
      'ledger',
      'ledger',
      previous.kid,
      current.kid,
    ]);
    expect(`${holding.held}${String(holding.wrappedKey)}`).not.toMatch(/secret-1|pasted-key/u);
    expect(revealed(await Effect.runPromise(after.reveal(holding)))).toBe('pasted-key');
    expect(revealed(await Effect.runPromise(after.reveal(holdingNow)))).toBe('pasted-key');
  });

  it('reveals no holding that names no kid, as one sealed under a key it does not know, and releases nothing', async () => {
    const keeper = sealedKeeper({ current });
    const holding = await Effect.runPromise(keeper.hold('secret-1', Redacted.make('pasted-key')));

    const refused = await Effect.runPromise(Effect.flip(keeper.reveal({ keptBy: 'ledger', held: holding.held })));
    await Effect.runPromise(keeper.release(holding));

    expect(refused).toMatchObject({ _tag: 'secret_key_unknown', kid: '' });
    expect(revealed(await Effect.runPromise(keeper.reveal(holding)))).toBe('pasted-key');
  });

  it('fills with zeros the data key it made once the value is sealed, and the one unwrapped once the value is opened', async () => {
    const custodian = recordingCustodian();
    const keeper = sealedKeeper({ current: custodian });

    const holding = await Effect.runPromise(keeper.hold('secret-1', Redacted.make('pasted-key')));
    const value = revealed(await Effect.runPromise(keeper.reveal(holding)));

    expect(value).toBe('pasted-key');
    expect(custodian.dataKeys().map((dataKey) => [dataKey.length, dataKey.some((byte) => byte !== 0)])).toEqual([
      [32, false],
      [32, false],
    ]);
  });
});
