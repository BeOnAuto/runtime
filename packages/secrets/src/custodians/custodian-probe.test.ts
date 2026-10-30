import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { custodianRefusal, recordingCustodian } from '../testing/recording-custodian.ts';
import { custodianProbed } from './custodian-probe.ts';

describe('the probe of a custodian', () => {
  it('has one data key wrapped and unwrapped, and fills both copies with zeros once done', async () => {
    const custodian = recordingCustodian();

    await Effect.runPromise(custodianProbed(custodian));

    expect([custodian.wraps(), custodian.unwraps()]).toEqual([1, 1]);
    expect(custodian.dataKeys().map((dataKey) => [dataKey.length, dataKey.every((byte) => byte === 0)])).toEqual([
      [32, true],
      [32, true],
    ]);
  });

  it('fails in the words of a custodian that refuses, and as a keeper that does not answer for one silent for 10 seconds', async () => {
    const refusing = recordingCustodian();
    const stalling = recordingCustodian();
    refusing.refuse();

    const refused = await Effect.runPromise(Effect.flip(custodianProbed(refusing)));
    const stalled = await Effect.runPromise(
      Effect.gen(function* () {
        const asked = stalling.stall();
        const probing = yield* Effect.forkChild(Effect.flip(custodianProbed(stalling)));
        yield* Effect.promise(() => asked);
        yield* TestClock.adjust('10 seconds');
        return yield* Fiber.join(probing);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(refused).toMatchObject({
      _tag: 'custodian_refused',
      detail: `The custodian of the key ${refusing.kid} refused to wrap a data key: ${custodianRefusal}`,
    });
    expect(stalled).toMatchObject({
      _tag: 'keeper_unavailable',
      detail: 'The keeper of the secret, or the custodian of its key, did not answer within 10 seconds',
    });
    expect(refusing.dataKeys().map((dataKey) => dataKey.every((byte) => byte === 0))).toEqual([true]);
  });
});
