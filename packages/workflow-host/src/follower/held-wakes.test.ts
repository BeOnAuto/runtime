import { streamSignalOf } from '@on.auto/ledger';
import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { HostWakeUp } from '../loop/host-wake-up.ts';
import type { MovingTime } from '../reaction-testing/follower-parts.ts';
import type { HeldPlaybook, HeldPlaybooks } from './followed-playbooks.ts';
import { followerWakeUpOf, type FollowerWork } from './follower-wake-up.ts';

const alpha = 'playbook/acme/alpha/';

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

const signal = { raised: Function.constVoid, renewed: Function.constVoid };

interface Holding {
  readonly work: FollowerWork;
  readonly log: () => readonly string[];
  readonly movedTo: (now: number) => void;
}

interface Passing {
  readonly failing: ReadonlySet<string>;
  readonly takesMs: number;
}

const passingAtOnce: Passing = { failing: new Set(), takesMs: 0 };

interface Upkept {
  readonly scheduleAt: number | null;
  readonly broken: Readonly<{ now: boolean }>;
}

const upkept: Upkept = { scheduleAt: at + 60_000, broken: { now: false } };

type Logged = (line: string) => Effect.Effect<void>;

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

function holdsAnswering(answers: readonly HeldPlaybooks[], logged: Logged): FollowerWork['holds'] {
  const asked = { count: 0 };
  const answered = Effect.sync(() => {
    asked.count += 1;
    return answers[asked.count - 1] ?? { due: [], nextAt: null };
  });
  return {
    heldAt: (now) => Effect.andThen(logged(`held at ${now - at}`), answered),
    failed: ({ playbookKey }, { at: triedAt, retryAt }) =>
      logged(`failed ${playbookKey} at ${triedAt - at}, again ${retryAt - triedAt}`),
  };
}

function passTaking(time: MovingTime, { failing, takesMs }: Passing, logged: Logged): FollowerWork['pass'] {
  return (playbookKey, mode, known) =>
    Effect.andThen(
      Effect.sync(() => {
        time.moved(takesMs);
      }),
      failing.has(playbookKey)
        ? Effect.die(new Error('The test failed this pass'))
        : Effect.as(logged(`pass ${playbookKey} ${mode} ${known?.hold?.holds ?? 'none'}`), 'waiting'),
    );
}

function workHolding(
  answers: readonly HeldPlaybooks[],
  { scheduleAt, broken }: Upkept = upkept,
  passing: Passing = passingAtOnce,
): Holding {
  const log: string[] = [];
  const clock = { now: at };
  const time: MovingTime = {
    now: () => clock.now,
    moved: (milliseconds) => {
      clock.now += milliseconds;
    },
  };
  const logged = (line: string) =>
    Effect.sync(() => {
      log.push(line);
    });
  const work: FollowerWork = {
    pass: passTaking(time, passing, logged),
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
    holds: holdsAnswering(answers, logged),
    rounds: roundsCounted(),
    clock: { now: time.now, sleep: Effect.sleep },
    sweepEveryMs: 1000,
    trouble: (what) => logged(what),
  };
  return {
    work,
    log: () => log,
    movedTo: (now) => {
      time.moved(now - time.now());
    },
  };
}

function wokenAt(work: HostWakeUp, holding: Holding, now: number, sweep: boolean) {
  holding.movedTo(now);
  return Effect.runPromise(work.wakeUp({ now, sweep }));
}

describe('the held playbooks, at a wake-up of the follower', () => {
  it('are passed once their time has come, at a wake that does not sweep too, and the follower is next due when the next hold is', async () => {
    const holding = workHolding([
      { due: [], nextAt: null },
      { due: [heldAlpha], nextAt: null },
      { due: [], nextAt: at + 4000 },
    ]);
    const work = followerWakeUpOf(holding.work, signal);
    onTestFinished(() => Effect.runPromise(work.stop()));

    const started = await wokenAt(work, holding, at, true);
    const woken = await wokenAt(work, holding, at + 1, false);

    expect(holding.log()).toEqual(['next sweep', 'held at 0', 'held at 1', `pass ${alpha} sweep 1`, 'held at 1']);
    expect([started, woken]).toEqual([{ nextDueAt: at + 60_000 }, { nextDueAt: at + 4000 }]);
  });
});

describe('the tries of the held playbooks, judged by the clock after them', () => {
  it('read again by the clock after the tries, so a hold a try that took a minute kept is read as the try wrote it', async () => {
    const holding = workHolding(
      [
        { due: [], nextAt: null },
        { due: [heldAlpha], nextAt: null },
        { due: [], nextAt: at + 105_001 },
      ],
      { scheduleAt: null, broken: { now: false } },
      { failing: new Set(), takesMs: 60_000 },
    );
    const work = followerWakeUpOf(holding.work, signal);
    onTestFinished(() => Effect.runPromise(work.stop()));

    await wokenAt(work, holding, at, true);
    const woken = await wokenAt(work, holding, at + 1, false);

    expect(holding.log().filter((line) => line.startsWith('held at'))).toEqual([
      'held at 0',
      'held at 1',
      'held at 60001',
    ]);
    expect(woken).toEqual({ nextDueAt: at + 105_001 });
  });

  it('say no try failed whose pass went through, though its hold is due again by the time the tries end, and wake at once for it', async () => {
    const holding = workHolding(
      [
        { due: [], nextAt: null },
        { due: [heldAlpha], nextAt: null },
        { due: [heldAlpha], nextAt: null },
      ],
      { scheduleAt: null, broken: { now: false } },
      { failing: new Set(), takesMs: 2000 },
    );
    const work = followerWakeUpOf(holding.work, signal);
    onTestFinished(() => Effect.runPromise(work.stop()));

    await wokenAt(work, holding, at, true);
    const woken = await wokenAt(work, holding, at + 1, false);

    expect(holding.log().filter((line) => line.startsWith('failed'))).toEqual([]);
    expect(woken).toEqual({ nextDueAt: at + 2001 });
  });
});

describe('a try of the held playbooks whose pass failed', () => {
  it('is said and put off a minute, and the follower wakes at once while a hold due was not tried', async () => {
    const holding = workHolding(
      [
        { due: [], nextAt: null },
        { due: [heldAlpha], nextAt: null },
        { due: [heldAlpha, heldBeta], nextAt: null },
        { due: [heldBeta], nextAt: null },
        { due: [heldBeta], nextAt: at + 90_000 },
      ],
      { scheduleAt: null, broken: { now: false } },
      { failing: new Set([alpha, heldBeta.playbookKey]), takesMs: 0 },
    );
    const work = followerWakeUpOf(holding.work, signal);
    onTestFinished(() => Effect.runPromise(work.stop()));

    const answers = [
      await wokenAt(work, holding, at, true),
      await wokenAt(work, holding, at + 1, false),
      await wokenAt(work, holding, at + 1, false),
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
    const keys = Array.from({ length: 64 }, (_, index) => `playbook/acme/p${index}/`);
    const sixtyFour = keys.map((playbookKey) => ({ ...heldAlpha, playbookKey }));
    const holding = workHolding(
      [
        { due: [], nextAt: null },
        { due: sixtyFour, nextAt: null },
        { due: sixtyFour, nextAt: null },
      ],
      { scheduleAt: null, broken: { now: false } },
      { failing: new Set(keys), takesMs: 0 },
    );
    const work = followerWakeUpOf(holding.work, signal);
    onTestFinished(() => Effect.runPromise(work.stop()));

    await wokenAt(work, holding, at, true);
    const woken = await wokenAt(work, holding, at + 1, false);

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
    const work = followerWakeUpOf(holding.work, signal);
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
    const work = followerWakeUpOf(workHolding([{ due: [], nextAt: at + 90_000 }]).work, signal);
    onTestFinished(() => Effect.runPromise(work.stop()));

    expect(await Effect.runPromise(work.wakeUp({ now: at, sweep: true }))).toEqual({ nextDueAt: at + 60_000 });
  });
});
