import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { localCustodian } from '../custodians/local-custodian.ts';
import { memoryKeeper, memoryKeeperRefusal } from '../fakes/memory-keeper.ts';
import { recordingCustodian } from '../testing/recording-custodian.ts';
import { keeperProbed } from './keeper-probe.ts';
import { sealedKeeper } from './sealed-keeper.ts';

const probeOfItsOwn = /^probe-[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}:1$/u;

describe('the probe of a keeper', () => {
  it('holds one value under an id of its own, unlike the id of any secret, reads it back and releases it', async () => {
    const keeper = memoryKeeper();

    await Effect.runPromise(keeperProbed(keeper));
    const [released] = keeper.released();

    expect(keeper.released()).toHaveLength(1);
    expect(released?.held).toMatch(probeOfItsOwn);
    expect(keeper.valueOf({ keptBy: keeper.name, held: String(released?.held) })).toBeUndefined();
  });

  it('fails as the keeper fails', async () => {
    const keeper = memoryKeeper();
    keeper.refuse();

    const refused = await Effect.runPromise(Effect.flip(keeperProbed(keeper)));

    expect(refused).toMatchObject({ _tag: 'keeper_unavailable', detail: memoryKeeperRefusal });
  });

  it('fails when the keeper reads back no value or another one, and still releases what it held', async () => {
    const keeper = memoryKeeper('forgetful');
    const forgetful = { ...keeper, reveal: () => Effect.undefined };

    const refused = await Effect.runPromise(Effect.flip(keeperProbed(forgetful)));
    const [released] = keeper.released();

    expect(refused).toMatchObject({
      _tag: 'keeper_unavailable',
      detail: `The keeper forgetful did not read back the value it had just held under ${String(released?.held)}`,
    });
    expect(keeper.released()).toHaveLength(1);
  });
});

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
