import { streamSignalOf } from '@on.auto/ledger';
import { Deferred, Effect, Exit, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { systemClock } from '../loop/host-clock.ts';
import type { HostWakeUp } from '../loop/host-wake-up.ts';
import type { Sweep } from '../sweeps/playbook-sweeps.ts';
import type { HeldPlaybook, HeldPlaybooks } from './followed-playbooks.ts';
import { followerWakeUpOf, type FollowerWork } from './follower-wake-up.ts';

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
        holds: { heldAt: () => Effect.succeed({ due: [], nextAt: null }), failed: () => Effect.void },
        rounds: { failed: () => Effect.succeed(60_000), succeeded: () => Effect.void },
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

const at = Date.parse('2026-11-11T09:00:00.000Z');

const heldAlpha: HeldPlaybook = {
  playbookKey: alpha,
  cursor: null,
  delivered: null,
  attempts: 0,
  waiting: true,
  hold: { heldFor: 'content', since: at - 1000, until: at, holds: 1 },
};

const heldBeta: HeldPlaybook = { ...heldAlpha, playbookKey: 'playbook/acme/beta/' };

interface Holding {
  readonly work: FollowerWork;
  readonly log: () => readonly string[];
}

interface Upkept {
  readonly scheduleAt: number | null;
  readonly broken: Readonly<{ now: boolean }>;
}

const upkept: Upkept = { scheduleAt: at + 60_000, broken: { now: false } };

function roundsCounted(): FollowerWork['rounds'] {
  const counted = { rounds: 0 };
  return {
    failed: () =>
      Effect.sync(() => {
        counted.rounds += 1;
        return counted.rounds * 1000;
      }),
    succeeded: () =>
      Effect.sync(() => {
        counted.rounds = 0;
      }),
  };
}

function workHolding(answers: readonly HeldPlaybooks[], { scheduleAt, broken }: Upkept = upkept): Holding {
  const log: string[] = [];
  const asked = { count: 0 };
  const logged = (line: string) =>
    Effect.sync(() => {
      log.push(line);
    });
  const answered = Effect.sync(() => {
    asked.count += 1;
    return answers[asked.count - 1] ?? { due: [], nextAt: null };
  });
  const work: FollowerWork = {
    pass: (playbookKey, mode, known) =>
      Effect.as(logged(`pass ${playbookKey} ${mode} ${known?.hold?.holds ?? 'none'}`), 'waiting'),
    discovery: { atStart: () => Effect.void, registriesAppended: () => Effect.void, playbookSeen: () => Effect.void },
    sweeps: {
      started: () => Effect.void,
      next: () => Effect.as(logged('next sweep'), { registries: [], playbooks: [], again: false }),
      passAgain: Function.constVoid,
      registriesRead: Function.constVoid,
    },
    upkeep: {
      sweep: () => Effect.void,
      fireSchedules: () =>
        Effect.suspend(() => (broken.now ? Effect.die(new Error('The schedules broke')) : Effect.void)),
      nextScheduleAt: () => Effect.succeed(scheduleAt),
    },
    appended: streamSignalOf(),
    holds: {
      heldAt: (now) => Effect.andThen(logged(`held at ${now - at}`), answered),
      failed: ({ playbookKey }, { at: triedAt, retryAt }) =>
        logged(`failed ${playbookKey} at ${triedAt - at}, again ${retryAt - triedAt}`),
    },
    rounds: roundsCounted(),
    clock: systemClock,
    sweepEveryMs: 1000,
    trouble: (what) => logged(what),
  };
  return { work, log: () => log };
}

describe('the held playbooks, at a wake-up of the follower', () => {
  it('are passed once their time has come, at a wake that does not sweep too, and the follower is next due when the next hold is', async () => {
    const holding = workHolding([
      { due: [], nextAt: null },
      { due: [heldAlpha], nextAt: null },
      { due: [], nextAt: at + 4000 },
    ]);
    const work = followerWakeUpOf(holding.work, { raised: Function.constVoid, renewed: Function.constVoid });
    onTestFinished(() => Effect.runPromise(work.stop()));

    const started = await Effect.runPromise(work.wakeUp({ now: at, sweep: true }));
    const woken = await Effect.runPromise(work.wakeUp({ now: at + 1, sweep: false }));

    expect(holding.log()).toEqual(['next sweep', 'held at 0', 'held at 1', `pass ${alpha} sweep 1`, 'held at 1']);
    expect([started, woken]).toEqual([{ nextDueAt: at + 60_000 }, { nextDueAt: at + 4000 }]);
  });

  it('say a try that failed and put it off a minute, and wake at once while a hold due was not tried', async () => {
    const holding = workHolding(
      [
        { due: [], nextAt: null },
        { due: [heldAlpha], nextAt: null },
        { due: [heldAlpha, heldBeta], nextAt: null },
        { due: [heldBeta], nextAt: null },
        { due: [heldBeta], nextAt: at + 90_000 },
      ],
      { scheduleAt: null, broken: { now: false } },
    );
    const work = followerWakeUpOf(holding.work, { raised: Function.constVoid, renewed: Function.constVoid });
    onTestFinished(() => Effect.runPromise(work.stop()));

    const answers = [
      await Effect.runPromise(work.wakeUp({ now: at, sweep: true })),
      await Effect.runPromise(work.wakeUp({ now: at + 1, sweep: false })),
      await Effect.runPromise(work.wakeUp({ now: at + 1, sweep: false })),
    ];

    expect(answers).toEqual([{ nextDueAt: null }, { nextDueAt: at + 1 }, { nextDueAt: at + 60_001 }]);
    expect(holding.log().filter((line) => line.startsWith('failed'))).toEqual([
      `failed ${alpha} at 1, again 60000`,
      `failed ${heldBeta.playbookKey} at 1, again 60000`,
    ]);
  });
});

describe('the held playbooks due, when every try at a wake fails', () => {
  it('wake at once when every one of the 64 tried failed, so the holds due after them are tried too', async () => {
    const sixtyFour = Array.from({ length: 64 }, (_, index) => ({
      ...heldAlpha,
      playbookKey: `playbook/acme/p${index}/`,
    }));
    const holding = workHolding(
      [
        { due: [], nextAt: null },
        { due: sixtyFour, nextAt: null },
        { due: sixtyFour, nextAt: null },
      ],
      { scheduleAt: null, broken: { now: false } },
    );
    const work = followerWakeUpOf(holding.work, { raised: Function.constVoid, renewed: Function.constVoid });
    onTestFinished(() => Effect.runPromise(work.stop()));

    await Effect.runPromise(work.wakeUp({ now: at, sweep: true }));
    const woken = await Effect.runPromise(work.wakeUp({ now: at + 1, sweep: false }));

    expect(woken).toEqual({ nextDueAt: at + 1 });
    expect(holding.log().filter((line) => line.startsWith('failed'))).toHaveLength(64);
  });
});

async function waitsAfter(work: HostWakeUp, now: number, wakes: number): Promise<readonly number[]> {
  if (wakes === 0) {
    return [];
  }
  const due = Number((await Effect.runPromise(work.wakeUp({ now, sweep: false }))).nextDueAt);
  return [due - now, ...(await waitsAfter(work, due, wakes - 1))];
}

describe('the time the follower is next due, with holds', () => {
  it('waits after a round that failed as long as the rounds failed in a row answer, whatever else is due, and tells them of a round that succeeds', async () => {
    const broken = { now: false };
    const holding = workHolding([], { scheduleAt: null, broken });
    const work = followerWakeUpOf(holding.work, { raised: Function.constVoid, renewed: Function.constVoid });
    onTestFinished(() => Effect.runPromise(work.stop()));
    const later = at + 3_600_000;

    const started = await Effect.runPromise(work.wakeUp({ now: at, sweep: true }));
    broken.now = true;
    const failing = await waitsAfter(work, at + 1, 3);
    broken.now = false;
    const succeeded = await Effect.runPromise(work.wakeUp({ now: later, sweep: false }));
    broken.now = true;
    const failingAgain = await waitsAfter(work, later + 1, 1);

    expect(failing).toEqual([1000, 2000, 3000]);
    expect([started, succeeded, failingAgain]).toEqual([{ nextDueAt: null }, { nextDueAt: null }, [1000]]);
    expect(holding.log()).toContain(
      'The follower of the playbooks failed; it tries again in a minute, twice as long after each round that fails in a row, at most an hour',
    );
  });

  it('wake the follower at the earlier of the next hold and the next schedule', async () => {
    const work = followerWakeUpOf(workHolding([{ due: [], nextAt: at + 90_000 }]).work, {
      raised: Function.constVoid,
      renewed: Function.constVoid,
    });
    onTestFinished(() => Effect.runPromise(work.stop()));

    expect(await Effect.runPromise(work.wakeUp({ now: at, sweep: true }))).toEqual({ nextDueAt: at + 60_000 });
  });
});
