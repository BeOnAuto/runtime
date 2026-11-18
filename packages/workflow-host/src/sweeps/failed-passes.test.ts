import { streamSignalOf, type AppendedStreams } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { FollowedOrgs } from '../follower/followed-orgs.ts';
import { startFollower } from '../follower/follower-loop.ts';
import type { Upkeep } from '../follower/follower-wake-up.ts';
import type { PassEnd } from '../follower/record-steps.ts';
import { systemClock, type HostClock } from '../loop/host-clock.ts';
import { until } from '../testing/until.ts';
import { orgSweepsOn } from './org-sweeps.ts';

const alpha = 'playbook/acme/alpha/';

const beta = 'playbook/globex/beta/';

const nothingDue: Omit<Upkeep, 'sweep'> = {
  fireSchedules: () => Effect.void,
  nextScheduleAt: () => Effect.succeed(null),
  nextDeferredAt: () => Effect.succeed(null),
};

const noOrgs: FollowedOrgs = {
  follow: () => Effect.void,
  load: () => Effect.die(new Error('The sweeps hand every org known')),
  save: () => Effect.void,
  heldIn: () => Effect.succeed(new Set()),
  parked: () => Effect.void,
  held: () => Effect.void,
  lifted: () => Effect.void,
  heldAt: () => Effect.succeed({ due: [], nextAt: null }),
  parkedForDelivery: () => Effect.succeed([]),
  waitingForASweep: () => Effect.succeed([]),
  following: () => Effect.succeed([]),
};

interface Following {
  readonly streams: readonly string[];
  readonly sweepEveryMs: number;
  readonly pass: (org: string) => Effect.Effect<PassEnd>;
  readonly upkeepFailing?: (sweep: number) => boolean;
  readonly orgSeen?: (org: string) => Effect.Effect<void>;
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
  const { streams, sweepEveryMs, pass, upkeepFailing = () => false, orgSeen = () => Effect.void } = following;
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
    passes: { org: pass, held: () => Effect.die(new Error('No playbook is held here')) },
    discovery: { atStart: () => Effect.void, orgSeen },
    sweeps: orgSweepsOn(store, noOrgs),
    upkeep: { sweep: upkeep, ...nothingDue },
    appended: streamSignalOf(),
    holds: { heldAt: noOrgs.heldAt, parkedForDelivery: noOrgs.parkedForDelivery, failed: () => Effect.void },
    rounds: { failed: () => Effect.succeed(60_000), succeeded: () => Effect.void },
    clock: systemClock,
    pace: recording.pace,
    sweepEveryMs,
    trouble: (what) => Effect.sync(() => troubles.push(what)),
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

describe('a sweep in which the pass over an org fails', () => {
  it('passes the orgs after it in the same sweep, and the org again at the next sweep', async () => {
    const passes: string[] = [];
    const watched = followed({
      streams: [`${alpha}events/`, `${beta}events/`],
      sweepEveryMs: 20,
      pass: passesFailingFirstFor('acme', (playbookKey) => {
        passes.push(playbookKey);
      }),
    });

    const passed = await passedReaching(passes, 2);

    expect(passed).toEqual(['globex', 'acme']);
    expect(watched.troubles()).toEqual(["A pass over an org's records failed; the next sweep passes the org again"]);
  });

  it('passes the org again when the next sweep fails before its passes', async () => {
    const passes: string[] = [];
    const watched = followed({
      streams: [`${alpha}events/`],
      sweepEveryMs: 20,
      pass: passesFailingFirstFor('acme', (playbookKey) => {
        passes.push(playbookKey);
      }),
      upkeepFailing: (sweep) => sweep === 2,
    });

    const passed = await passedReaching(passes, 1);

    expect(passed).toEqual(['acme']);
    expect(watched.troubles()).toEqual([
      "A pass over an org's records failed; the next sweep passes the org again",
      'The follower of the playbooks failed; it tries again in a minute, twice as long after each round that fails in a row, at most an hour',
    ]);
  });
});

describe('a sweep in which following an org it finds fails', () => {
  it('passes the orgs after it in the same sweep, and the org again at the next sweep', async () => {
    const passes: string[] = [];
    const watched = followed({
      streams: [`${alpha}events/`, `${beta}events/`],
      sweepEveryMs: 20,
      pass: passesRecorded((playbookKey) => {
        passes.push(playbookKey);
      }),
      orgSeen: failingOnceFor('acme', () => Effect.void),
    });

    const passed = await passedReaching(passes, 2);

    expect(passed).toEqual(['globex', 'acme']);
    expect(watched.troubles()).toEqual(["A pass over an org's records failed; the next sweep passes the org again"]);
  });
});

describe('a sweep in which more orgs fail than it has room for', () => {
  it('waits for the next interval rather than sweeping again at once', async () => {
    const streams = Array.from({ length: 130 }, (_, index) => `playbook/o${index}/alpha/events/`);
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
