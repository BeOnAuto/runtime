import { streamSignalOf } from '@on.auto/ledger';
import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { systemClock, type HostClock } from '../loop/host-clock.ts';
import type { Sweep } from '../sweeps/playbook-sweeps.ts';
import { until } from '../testing/until.ts';
import { startFollower } from './follower-loop.ts';
import type { PassEnd } from './record-steps.ts';

const anHour = 3_600_000;

const nothingToSweep: Sweep = { registries: [], playbooks: [], again: false };

interface Watched {
  readonly raise: (stream: string) => void;
  readonly log: () => readonly string[];
  readonly asked: () => readonly number[];
}

interface Following {
  readonly passEnds?: readonly (PassEnd | 'fails')[];
  readonly sweeps?: readonly Sweep[];
  readonly sweepEveryMs?: number;
  readonly startsFailing?: number;
  readonly schedulesFailing?: number;
  readonly sweepsFailing?: number;
  readonly followFailingOnce?: string;
  readonly firesFailing?: number;
  readonly startsAt?: number;
  readonly sweepTakesMs?: number;
}

interface Paced {
  readonly pace: HostClock;
  readonly asked: () => readonly number[];
  readonly passed: (milliseconds: number) => void;
}

function pacedFrom(startsAt: number | undefined): Paced {
  const asked: number[] = [];
  const time = { now: startsAt ?? 0 };
  const recorded = (milliseconds: number): void => {
    asked.push(milliseconds);
  };
  const stepped: HostClock = {
    now: () => time.now,
    sleep: (milliseconds) =>
      Effect.suspend(() => {
        recorded(milliseconds);
        return milliseconds > 0 ? Effect.never : Effect.void;
      }),
  };
  const system: HostClock = {
    now: systemClock.now,
    sleep: (milliseconds) =>
      Effect.andThen(
        Effect.sync(() => {
          recorded(milliseconds);
        }),
        systemClock.sleep(milliseconds),
      ),
  };
  return {
    pace: startsAt === undefined ? system : stepped,
    asked: () => asked,
    passed: (milliseconds) => {
      time.now += milliseconds;
    },
  };
}

function failingFirst<A>(times: number, read: Effect.Effect<A>): () => Effect.Effect<A> {
  const failures = { left: times };
  return () =>
    Effect.suspend(() => {
      failures.left -= 1;
      return failures.left < 0 ? read : Effect.die(new Error('The database is down'));
    });
}

function followsFailingOnceFor(failing: string | undefined): (playbookKey: string) => Effect.Effect<void> {
  const follow = failingFirst(1, Effect.void);
  return (playbookKey) => (playbookKey === failing ? follow() : Effect.void);
}

function inTurn<A>(items: readonly A[], after: A): () => A {
  const taken = { next: 0 };
  return () => {
    const item = items[taken.next] ?? after;
    taken.next += 1;
    return item;
  };
}

function followerWith(following: Following = {}): Watched {
  const log: string[] = [];
  const logged = (line: string) =>
    Effect.sync(() => {
      log.push(line);
    });
  const appended = streamSignalOf();
  const passEnd = inTurn<PassEnd | 'fails'>(following.passEnds ?? [], 'caught_up');
  const sweep = inTurn(following.sweeps ?? [], nothingToSweep);
  const { pace, asked, passed } = pacedFrom(following.startsAt);
  const sweptAfter = (): Sweep => {
    passed(following.sweepTakesMs ?? 0);
    return sweep();
  };
  const follower = startFollower({
    pass: (playbookKey, mode) =>
      Effect.suspend(() => {
        const end = passEnd();
        return end === 'fails'
          ? Effect.die(new Error('The pass broke'))
          : Effect.as(logged(`pass ${playbookKey} ${mode}`), end);
      }),
    discovery: {
      atStart: failingFirst(following.startsFailing ?? 0, logged('start')),
      registriesAppended: (registries) => logged(`registries ${registries.join(' ')}`),
      playbookSeen: followsFailingOnceFor(following.followFailingOnce),
    },
    sweeps: {
      started: () => logged('anchored'),
      next: failingFirst(following.sweepsFailing ?? 0, Effect.sync(sweptAfter)),
      passAgain: (playbookKey) => {
        log.push(`handed back ${playbookKey}`);
      },
      registriesRead: Function.constVoid,
    },
    upkeep: {
      sweep: () => logged('sweep'),
      fireSchedules: failingFirst(following.firesFailing ?? 0, Effect.void),
      nextScheduleAt: failingFirst(following.schedulesFailing ?? 0, Effect.succeed(null)),
    },
    appended,
    clock: pace,
    pace,
    sweepEveryMs: following.sweepEveryMs ?? anHour,
    trouble: (what) => logged(what),
  });
  onTestFinished(() => follower.stop());
  return { raise: appended.raise, log: () => log, asked };
}

function logReaching(watched: Watched, length: number) {
  return until(
    () => Promise.resolve<readonly string[]>([...watched.log()]),
    (log) => log.length >= length,
  );
}

describe('the follower of the playbooks', () => {
  it('takes its place in the ledger and finds the playbooks at its start, sweeps, and reads a registry appended to', async () => {
    const watched = followerWith();
    await logReaching(watched, 3);

    watched.raise('org/acme/playbooks');
    const log = await logReaching(watched, 4);

    expect(log).toEqual(['anchored', 'start', 'sweep', 'registries org/acme/playbooks']);
  });

  it('passes a playbook an event was appended to, not one a run appended to, and again while the pass says there is more', async () => {
    const watched = followerWith({ passEnds: ['more', 'more', 'caught_up'] });
    await logReaching(watched, 3);

    watched.raise('playbook/acme/beta/run-logs/r-1');
    watched.raise('playbook/acme/alpha/events/e1');
    watched.raise('workflow/elsewhere');
    const log = await logReaching(watched, 6);

    expect(log.slice(3)).toEqual([
      'pass playbook/acme/alpha/ signal',
      'pass playbook/acme/alpha/ signal',
      'pass playbook/acme/alpha/ signal',
    ]);
  });

  it('reads the registries a sweep names, passes the playbooks it hands out, and sweeps again at once when it says so', async () => {
    const handedOut: Sweep = {
      registries: ['org/acme/playbooks'],
      playbooks: [{ playbookKey: 'playbook/acme/alpha/', known: undefined }],
      again: true,
    };
    const watched = followerWith({ sweeps: [handedOut] });

    const log = await logReaching(watched, 6);

    expect(log).toEqual([
      'anchored',
      'start',
      'registries org/acme/playbooks',
      'sweep',
      'pass playbook/acme/alpha/ sweep',
      'sweep',
    ]);
  });
});

describe('the follower of the playbooks, when a read fails', () => {
  it('says a read that failed at its start or while it waits is trouble, and reads again at the next sweep', async () => {
    const watched = followerWith({ sweepEveryMs: 20, startsFailing: 1, schedulesFailing: 1 });

    const log = await logReaching(watched, 7);

    expect(log.slice(0, 7)).toEqual([
      'anchored',
      'The follower of the playbooks could not find the playbooks at its start; it tries again at the next sweep',
      'anchored',
      'start',
      'sweep',
      'The next due time of the schedules could not be read; the follower waits for the next sweep',
      'sweep',
    ]);
  });

  it('says a sweep that failed is trouble, and sweeps again at the next interval', async () => {
    const watched = followerWith({ sweepEveryMs: 20, sweepsFailing: 1 });

    const log = await logReaching(watched, 4);

    expect(log.slice(0, 4)).toEqual([
      'anchored',
      'start',
      'The follower of the playbooks failed; it tries again',
      'sweep',
    ]);
  });
});

describe('the follower of the playbooks, when a pass over a playbook fails', () => {
  it('says a pass that fails is trouble, and passes again at the next signal', async () => {
    const watched = followerWith({ passEnds: ['fails'] });
    await logReaching(watched, 3);

    watched.raise('playbook/acme/alpha/events/e1');
    await logReaching(watched, 5);
    watched.raise('playbook/acme/alpha/events/e2');
    const log = await logReaching(watched, 6);

    expect(log.slice(3)).toEqual([
      'A pass over a playbook failed; the next sweep passes the playbook again',
      'handed back playbook/acme/alpha/',
      'pass playbook/acme/alpha/ signal',
    ]);
  });

  it('says a follow of a signalled playbook that fails is trouble for that playbook alone, passes the others, and hands the playbook back', async () => {
    const watched = followerWith({ followFailingOnce: 'playbook/acme/alpha/' });
    await logReaching(watched, 3);

    watched.raise('playbook/acme/alpha/events/e1');
    watched.raise('playbook/acme/beta/events/e1');
    const log = await logReaching(watched, 6);

    expect(log.slice(3)).toEqual([
      'A pass over a playbook failed; the next sweep passes the playbook again',
      'handed back playbook/acme/alpha/',
      'pass playbook/acme/beta/ signal',
    ]);
  });
});

describe('the follower of the playbooks, between its sweeps', () => {
  it('sweeps again at once after a sweep that left more to read, and counts its next sweep from the sweep its loop asked for', async () => {
    const more: Sweep = { ...nothingToSweep, again: true };
    const watched = followerWith({ sweeps: [more], startsAt: 1_000_000, sweepTakesMs: 100 });

    const asked = await until(watched.asked, (sleeps) => sleeps.length >= 2);

    expect([asked.slice(0, 2), watched.log().filter((line) => line === 'sweep')]).toEqual([
      [0, anHour - 200],
      ['sweep', 'sweep'],
    ]);
  });

  it('leaves the sweep to the next interval after a round that failed before its sweep, rather than sweeping again at once', async () => {
    const watched = followerWith({ firesFailing: 1, startsAt: 1_000_000 });

    const asked = await until(watched.asked, (sleeps) => sleeps.length > 0);

    expect([asked, watched.log()]).toEqual([
      [anHour],
      ['anchored', 'start', 'The follower of the playbooks failed; it tries again'],
    ]);
  });
});
