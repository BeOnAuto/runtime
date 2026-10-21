import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryKeeper, memoryKeeperRefusal } from '../fakes/memory-keeper.ts';
import { keeperProbed } from './keeper-probe.ts';

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
