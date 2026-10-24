import { Deferred, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { oneWakeAtATime, type NextWake, type Woken } from './host-wake-up.ts';

interface Counted {
  readonly wakeUp: (woken: Woken) => Promise<NextWake>;
  readonly rounds: () => readonly Woken[];
  readonly release: () => Promise<void>;
}

function countedWakeUp(failing: boolean): Counted {
  const rounds: Woken[] = [];
  const holding = { gate: Deferred.makeUnsafe<void>() };
  const wakeUp = oneWakeAtATime((woken) =>
    Effect.suspend(() => {
      rounds.push(woken);
      const round = Deferred.await(holding.gate).pipe(Effect.as({ nextDueAt: woken.now + 1000 }));
      return failing ? Effect.andThen(round, Effect.die(new Error('The round broke'))) : round;
    }),
  );
  return {
    wakeUp: (woken) => Effect.runPromise(wakeUp(woken)),
    rounds: () => rounds,
    release: async () => {
      await Effect.runPromise(Deferred.done(holding.gate, Exit.void));
      holding.gate = Deferred.makeUnsafe<void>();
    },
  };
}

const anError: unknown = expect.any(Error);

describe('a wake-up woken while it runs', () => {
  it('runs one round: the wake that comes while one runs waits for it and answers what it answers, and a later wake runs a round of its own', async () => {
    const counted = countedWakeUp(false);

    const together = Promise.all([counted.wakeUp({ now: 1, sweep: true }), counted.wakeUp({ now: 2, sweep: false })]);
    await counted.release();
    const answers = await together;
    const later = counted.wakeUp({ now: 3, sweep: false });
    await counted.release();

    expect([answers, await later, counted.rounds()]).toEqual([
      [{ nextDueAt: 1001 }, { nextDueAt: 1001 }],
      { nextDueAt: 1003 },
      [
        { now: 1, sweep: true },
        { now: 3, sweep: false },
      ],
    ]);
  });

  it('fails both wakes with the round that failed, and runs the next wake anew', async () => {
    const counted = countedWakeUp(true);

    const together = Promise.allSettled([
      counted.wakeUp({ now: 1, sweep: true }),
      counted.wakeUp({ now: 2, sweep: true }),
    ]);
    await counted.release();
    const settled = await together;
    const later = counted.wakeUp({ now: 3, sweep: true }).catch((error: unknown) => error);
    await counted.release();

    expect(settled.map((outcome: Readonly<PromiseSettledResult<NextWake>>) => outcome.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect([await later, counted.rounds().length]).toEqual([anError, 2]);
  });
});
