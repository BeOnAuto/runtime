import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { tallyFolderOf } from '../folder-testing/tally-folder.ts';
import { someFolder } from '../projector/folder.ts';
import { aSQLiteFile } from './host-files.ts';
import { hostedOn } from './host-runs.ts';
import { steppedClock } from './stepped-clock.ts';

const start = Date.parse('2026-10-06T09:00:00.000Z');

describe('a stepped clock', () => {
  it('ends a sleep of nothing at once, with no step, as a clock that has already passed the time would', async () => {
    const clock = steppedClock(start);

    await Effect.runPromise(clock.sleep(0));

    expect([clock.asleep(), clock.now()]).toEqual([0, start]);
  });

  it('ends a sleep at the step that reaches its time, and not before', async () => {
    const clock = steppedClock(start);
    const sleep = Effect.runPromise(clock.sleep(1000));
    clock.step(999);
    const early = clock.asleep();
    clock.step(1);
    await sleep;

    expect([early, clock.asleep(), clock.now()]).toEqual([1, 0, start + 1000]);
  });

  it('says once as many sleep on it as a test waits for, and forgets a sleep that was interrupted', async () => {
    const clock = steppedClock(start);
    const asleep = clock.asleepAtLeast(2);
    const first = Effect.runFork(clock.sleep(1000));
    Effect.runFork(clock.sleep(2000));

    const counted = await asleep;
    await Effect.runPromise(Fiber.interrupt(first));

    expect([counted, clock.asleep()]).toEqual([2, 1]);
  });
});

describe('a host on a stepped clock, at rest', () => {
  it('holds a sleep for its loop and one for the keeper of its lease, and one more for its projector', async () => {
    const bare = steppedClock(start);
    const folding = steppedClock(start);
    await hostedOn({ store: 'sqlite', file: aSQLiteFile() }, { clock: bare, sweepEveryMs: 20 });
    await hostedOn(
      { store: 'sqlite', file: aSQLiteFile() },
      {
        clock: folding,
        sweepEveryMs: 20,
        projector: { folders: [someFolder(tallyFolderOf(1))], playbooksAtOnce: 1, pagesPerWake: 1 },
      },
    );

    expect([await bare.asleepAtLeast(2), await folding.asleepAtLeast(3)]).toEqual([2, 3]);
  });
});
