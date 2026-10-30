import { streamSignalOf } from '@on.auto/ledger';
import { Deferred, Effect, Exit, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { systemClock } from '../loop/host-clock.ts';
import type { Sweep } from '../sweeps/playbook-sweeps.ts';
import { followerWakeUpOf } from './follower-wake-up.ts';

const alpha = 'playbook/acme/alpha/';

const handingOutAlpha: Sweep = { registries: [], playbooks: [{ playbookKey: alpha, known: undefined }], again: false };

describe('the wake-up of the follower of the playbooks', () => {
  it('runs one wake at a time: two wakes together take its place once, find the playbooks once, sweep once and pass each playbook once', async () => {
    const log: string[] = [];
    const logged = (line: string) =>
      Effect.sync(() => {
        log.push(line);
      });
    const finding = Deferred.makeUnsafe<void>();
    const work = followerWakeUpOf(
      {
        pass: (playbookKey, mode) => Effect.as(logged(`pass ${playbookKey} ${mode}`), 'caught_up'),
        discovery: {
          atStart: () => Effect.andThen(logged('start'), Deferred.await(finding)),
          registriesAppended: () => Effect.void,
          playbookSeen: () => Effect.void,
        },
        sweeps: {
          started: () => logged('anchored'),
          next: () => Effect.as(logged('next sweep'), handingOutAlpha),
          passAgain: Function.constVoid,
          registriesRead: Function.constVoid,
        },
        upkeep: {
          sweep: () => logged('sweep'),
          fireSchedules: () => Effect.void,
          nextScheduleAt: () => Effect.succeed(null),
        },
        appended: streamSignalOf(),
        clock: systemClock,
        sweepEveryMs: 1000,
        trouble: (what) => logged(what),
      },
      { raised: Function.constVoid, renewed: Function.constVoid },
    );
    onTestFinished(() => Effect.runPromise(work.stop()));
    const woken = { now: Date.now(), sweep: true };

    const together = Promise.all([Effect.runPromise(work.wakeUp(woken)), Effect.runPromise(work.wakeUp(woken))]);
    await Effect.runPromise(Deferred.done(finding, Exit.void));
    const answers = await together;

    expect(log).toEqual(['anchored', 'start', 'next sweep', 'sweep', `pass ${alpha} sweep`]);
    expect(answers).toEqual([{ nextDueAt: null }, { nextDueAt: null }]);
  });
});
