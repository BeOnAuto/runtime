import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { steppedClock } from './stepped-sweeps.ts';

const start = Date.parse('2026-10-06T09:00:00.000Z');

function slept(sleep: Effect.Effect<void>): { readonly ended: () => boolean } {
  const state = { ended: false };
  const noting = Effect.sync(() => {
    state.ended = true;
  });
  void Effect.runPromise(sleep.pipe(Effect.andThen(noting)));
  return { ended: () => state.ended };
}

async function settled(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe('a stepped clock', () => {
  it('ends a sleep of nothing at once, with no step, as a clock that has already passed the time would', async () => {
    const clock = steppedClock(start);
    const sleep = slept(clock.sleep(0));
    await settled();
    expect([sleep.ended(), clock.now()]).toEqual([true, start]);
  });

  it('ends a sleep at the step that reaches its time, and not before', async () => {
    const clock = steppedClock(start);
    const sleep = slept(clock.sleep(1000));
    clock.step(999);
    await settled();
    const early = sleep.ended();
    clock.step(1);
    await settled();
    expect([early, sleep.ended(), clock.now()]).toEqual([false, true, start + 1000]);
  });
});
