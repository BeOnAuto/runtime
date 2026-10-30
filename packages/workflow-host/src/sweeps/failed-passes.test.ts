import { streamSignalOf, type AppendedStreams } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { FollowedPlaybooks } from '../follower/followed-playbooks.ts';
import { startFollower } from '../follower/follower-loop.ts';
import type { PassEnd } from '../follower/record-steps.ts';
import { systemClock, type HostClock } from '../loop/host-clock.ts';
import { until } from '../testing/until.ts';
import { playbookSweepsOn } from './playbook-sweeps.ts';

const alpha = 'playbook/acme/alpha/';

const beta = 'playbook/acme/beta/';

const noPlaybooks: FollowedPlaybooks = {
  follow: () => Effect.void,
  load: () => Effect.die(new Error('The sweeps hand every playbook known')),
  save: () => Effect.void,
  waitingForASweep: () => Effect.succeed([]),
  following: () => Effect.succeed([]),
};

interface Following {
  readonly streams: readonly string[];
  readonly sweepEveryMs: number;
  readonly pass: (playbookKey: string) => Effect.Effect<PassEnd>;
  readonly upkeepFailing?: (sweep: number) => boolean;
  readonly registries?: (registries: readonly string[]) => Effect.Effect<void>;
  readonly playbookSeen?: (playbookKey: string) => Effect.Effect<void>;
}

interface Wait {
  readonly milliseconds: number;
  readonly sweptBefore: number;
}

interface Followed {
  readonly waits: () => readonly Wait[];
  readonly sweeps: () => number;
  readonly upkeeps: () => number;
  readonly troubles: () => readonly string[];
  readonly stop: () => Promise<void>;
}

function recordingWaits(sweeps: () => number): { readonly pace: HostClock; readonly waits: () => readonly Wait[] } {
  const waits: Wait[] = [];
  return {
    pace: {
      now: systemClock.now,
      sleep: (milliseconds) => {
        waits.push({ milliseconds, sweptBefore: sweeps() });
        return systemClock.sleep(milliseconds);
      },
    },
    waits: () => [...waits],
  };
}

function followed(following: Following): Followed {
  const {
    streams,
    sweepEveryMs,
    pass,
    upkeepFailing = () => false,
    registries = () => Effect.void,
    playbookSeen = () => Effect.void,
  } = following;
  const counts = { reads: 0, upkeeps: 0 };
  const troubles: string[] = [];
  const recording = recordingWaits(() => counts.reads - 1);
  const store = {
    readAppended: (): Promise<AppendedStreams> => {
      counts.reads += 1;
      const appended = counts.reads === 2 ? streams : [];
      return Promise.resolve({ streams: appended, through: [String(counts.reads)], more: false });
    },
  };
  const upkeep = () =>
    Effect.suspend(() => {
      counts.upkeeps += 1;
      return upkeepFailing(counts.upkeeps) ? Effect.die(new Error('The backlog could not be read')) : Effect.void;
    });
  const follower = startFollower({
    pass,
    discovery: { atStart: () => Effect.void, registriesAppended: registries, playbookSeen },
    sweeps: playbookSweepsOn(store, noPlaybooks),
    upkeep: { sweep: upkeep, fireSchedules: () => Effect.void, nextScheduleAt: () => Effect.succeed(null) },
    appended: streamSignalOf(),
    clock: systemClock,
    pace: recording.pace,
    sweepEveryMs,
    trouble: (what) =>
      Effect.sync(() => {
        troubles.push(what);
      }),
  });
  onTestFinished(() => follower.stop());
  return {
    waits: recording.waits,
    sweeps: () => counts.reads - 1,
    upkeeps: () => counts.upkeeps,
    troubles: () => troubles,
    stop: follower.stop,
  };
}

function failingOnceFor<A>(failing: string, otherwise: (playbookKey: string) => Effect.Effect<A>) {
  const failures = { left: 1 };
  return (playbookKey: string) =>
    Effect.suspend(() => {
      if (playbookKey === failing && failures.left > 0) {
        failures.left -= 1;
        return Effect.die(new Error('The ledger could not be read'));
      }
      return otherwise(playbookKey);
    });
}

function passesRecorded(passed: (playbookKey: string) => void) {
  return (playbookKey: string) =>
    Effect.sync((): PassEnd => {
      passed(playbookKey);
      return 'caught_up';
    });
}

function passesFailingFirstFor(failing: string, passed: (playbookKey: string) => void) {
  return failingOnceFor(failing, passesRecorded(passed));
}

function passedReaching(passes: readonly string[], count: number) {
  return until(
    () => Promise.resolve<readonly string[]>([...passes]),
    (playbooks) => playbooks.length >= count,
  );
}

describe('a sweep in which the pass over a playbook fails', () => {
  it('passes the playbooks after it in the same sweep, and the playbook again at the next sweep', async () => {
    const passes: string[] = [];
    const watched = followed({
      streams: [`${alpha}events/`, `${beta}events/`],
      sweepEveryMs: 20,
      pass: passesFailingFirstFor(alpha, (playbookKey) => {
        passes.push(playbookKey);
      }),
    });

    const passed = await passedReaching(passes, 2);

    expect(passed).toEqual([beta, alpha]);
    expect(watched.troubles()).toEqual(['A pass over a playbook failed; the next sweep passes the playbook again']);
  });

  it('passes the playbook again when the next sweep fails before its passes', async () => {
    const passes: string[] = [];
    const watched = followed({
      streams: [`${alpha}events/`],
      sweepEveryMs: 20,
      pass: passesFailingFirstFor(alpha, (playbookKey) => {
        passes.push(playbookKey);
      }),
      upkeepFailing: (sweep) => sweep === 2,
    });

    const passed = await passedReaching(passes, 1);

    expect(passed).toEqual([alpha]);
    expect(watched.troubles()).toEqual([
      'A pass over a playbook failed; the next sweep passes the playbook again',
      'The follower of the playbooks failed; it tries again',
    ]);
  });
});

describe('a sweep in which following a playbook it finds fails', () => {
  it('passes the playbooks after it in the same sweep, and the playbook again at the next sweep', async () => {
    const passes: string[] = [];
    const watched = followed({
      streams: [`${alpha}events/`, `${beta}events/`],
      sweepEveryMs: 20,
      pass: passesRecorded((playbookKey) => {
        passes.push(playbookKey);
      }),
      playbookSeen: failingOnceFor(alpha, () => Effect.void),
    });

    const passed = await passedReaching(passes, 2);

    expect(passed).toEqual([beta, alpha]);
    expect(watched.troubles()).toEqual(['A pass over a playbook failed; the next sweep passes the playbook again']);
  });
});

describe('a sweep in which more playbooks fail than it has room for', () => {
  it('waits for the next interval rather than sweeping again at once', async () => {
    const streams = Array.from({ length: 130 }, (_, index) => `playbook/acme/b${index}/events/`);
    const watched = followed({
      streams,
      sweepEveryMs: 1000,
      pass: () => Effect.die(new Error('The ledger could not be read')),
    });

    const waits = await until(watched.waits, (asked) => asked.some(({ milliseconds }) => milliseconds > 0));
    const firstWait = waits.find(({ milliseconds }) => milliseconds > 0);

    expect(firstWait?.sweptBefore).toBeLessThanOrEqual(2);
  });
});

function registryReadFailingOnce(read: (registries: readonly string[]) => void) {
  const failures = { left: 1 };
  return (registries: readonly string[]) =>
    Effect.suspend(() => {
      failures.left -= 1;
      if (failures.left >= 0) {
        return Effect.die(new Error('The registry could not be read'));
      }
      read(registries);
      return Effect.void;
    });
}

describe('a sweep whose read of a registry of playbooks fails', () => {
  it('reads the registry again at the next sweep after its read failed', async () => {
    const followedFrom: string[] = [];
    const watched = followed({
      streams: ['org/acme/playbooks'],
      sweepEveryMs: 20,
      pass: () => Effect.succeed<PassEnd>('caught_up'),
      registries: registryReadFailingOnce((registries) => {
        followedFrom.push(...registries);
      }),
    });

    const read = await until(
      () => Promise.resolve<readonly string[]>([...followedFrom]),
      (registries) => registries.length > 0,
    );

    expect(read).toEqual(['org/acme/playbooks']);
    expect(watched.troubles()).toEqual(['A registry of playbooks could not be read; the next sweep reads it again']);
  });
});

describe('a sweep whose read of a registry of playbooks keeps failing', () => {
  it('still passes the playbooks appended to, and still runs its upkeep', async () => {
    const passes: string[] = [];
    const watched = followed({
      streams: ['org/acme/playbooks', 'playbook/acme/alpha/events/'],
      sweepEveryMs: 50,
      pass: (playbookKey) =>
        Effect.sync(() => {
          passes.push(playbookKey);
          return 'caught_up' satisfies PassEnd;
        }),
      registries: () => Effect.die(new Error('The registry could not be read')),
    });

    const passed = await passedReaching(passes, 1);
    await until(
      () => Promise.resolve(watched.upkeeps()),
      (upkeeps) => upkeeps >= 3,
    );
    await watched.stop();

    expect(passed).toEqual(['playbook/acme/alpha/']);
    expect(watched.upkeeps()).toBe(watched.sweeps());
    expect(watched.troubles()).toEqual(
      Array.from(
        { length: watched.sweeps() },
        () => 'A registry of playbooks could not be read; the next sweep reads it again',
      ),
    );
  });
});
