import type { AppendedStreams } from '@on.auto/ledger';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FollowedPlaybook, FollowedPlaybooks } from '../follower/followed-playbooks.ts';
import { playbookSweepsOn, playbooksInASweep, waitingInASweep, type Sweep } from './playbook-sweeps.ts';

interface Swept {
  readonly sweeps: readonly Sweep[];
  readonly readsAfter: readonly (readonly string[] | undefined)[];
}

interface Ledger {
  readonly appended: readonly AppendedStreams[];
  readonly waiting?: readonly FollowedPlaybook[];
  readonly followed?: readonly FollowedPlaybook[];
}

function playbookNamed(index: number): string {
  return `playbook/acme/b${String(index).padStart(4, '0')}/`;
}

function followedPlaybook(playbookKey: string, waiting: boolean): FollowedPlaybook {
  return { playbookKey, cursor: null, delivered: null, attempts: waiting ? 1 : 0, waiting };
}

function playbooksNumbered(count: number, waiting: boolean): readonly FollowedPlaybook[] {
  return Array.from({ length: count }, (_, index) => followedPlaybook(playbookNamed(index), waiting));
}

function followedOf({ waiting = [], followed = [] }: Ledger): FollowedPlaybooks {
  return {
    follow: () => Effect.void,
    load: () => Effect.die(new Error('The sweeps load no playbook')),
    save: () => Effect.void,
    waitingForASweep: (limit) => Effect.succeed(waiting.slice(0, limit)),
    following: (after, limit) =>
      Effect.succeed(followed.filter(({ playbookKey }) => playbookKey > after).slice(0, limit)),
  };
}

async function sweptOver(ledger: Ledger, sweeps: number): Promise<Swept> {
  const readsAfter: (readonly string[] | undefined)[] = [];
  const answers = { next: 0 };
  const store = {
    readAppended: (after: readonly string[] | undefined) => {
      readsAfter.push(after);
      const answer = ledger.appended[answers.next] ?? { streams: [], through: [String(answers.next)], more: false };
      answers.next += 1;
      return Promise.resolve(answer);
    },
  };
  const playbookSweeps = playbookSweepsOn(store, followedOf(ledger));
  await Effect.runPromise(playbookSweeps.started());
  const swept = await Effect.runPromise(
    Effect.forEach(Array.from({ length: sweeps }), () =>
      Effect.tap(playbookSweeps.next(), (sweep) =>
        Effect.sync(() => {
          playbookSweeps.registriesRead(sweep.registries);
        }),
      ),
    ),
  );
  return { sweeps: swept, readsAfter };
}

function keysOf(sweep: Sweep | undefined): readonly string[] {
  return (sweep?.playbooks ?? []).map(({ playbookKey }) => playbookKey);
}

const now: AppendedStreams = { streams: [], through: ['10'], more: false };

describe('the sweeps of the follower', () => {
  it('hand out each playbook appended to since the last read once, but not one only a run appended to, and name the registries', async () => {
    const appended: AppendedStreams = {
      streams: [
        'playbook/acme/alpha/events/',
        'playbook/acme/alpha/definitions/',
        'playbook/acme/beta/run-logs/',
        'org/acme/playbooks',
        'org/acme/keys/k1',
        'workflow/elsewhere',
      ],
      through: ['20'],
      more: false,
    };

    const { sweeps, readsAfter } = await sweptOver({ appended: [now, appended] }, 2);

    expect(sweeps).toEqual([
      {
        registries: ['org/acme/playbooks'],
        playbooks: [{ playbookKey: 'playbook/acme/alpha/', known: undefined }],
        again: false,
      },
      { registries: [], playbooks: [], again: false },
    ]);
    expect(readsAfter).toEqual([undefined, ['10'], ['20']]);
  });

  it('keep half of a sweep for playbooks that wait, and the rest for playbooks appended to, the others at the next sweep', async () => {
    const changed = Array.from(
      { length: 100 },
      (_, index) => `playbook/acme/c${String(index).padStart(4, '0')}/events/`,
    );
    const appended: AppendedStreams = { streams: changed, through: ['20'], more: false };

    const { sweeps } = await sweptOver({ appended: [now, appended], waiting: playbooksNumbered(200, true) }, 2);

    expect(sweeps.map((sweep) => [sweep.playbooks.length, sweep.again])).toEqual([
      [playbooksInASweep, true],
      [waitingInASweep + 36, false],
    ]);
    expect(sweeps[0]?.playbooks.filter(({ known }) => known?.waiting === true)).toHaveLength(waitingInASweep);
    expect(keysOf(sweeps[1]).at(-1)).toBe('playbook/acme/c0099/');
  });
});

describe('the sweeps of the follower after its start', () => {
  it('go once over every playbook followed at their start, as many at a sweep as there is room for', async () => {
    const { sweeps } = await sweptOver({ appended: [now], followed: playbooksNumbered(200, false) }, 3);

    expect(sweeps.map((sweep) => sweep.playbooks.length)).toEqual([playbooksInASweep, 200 - playbooksInASweep, 0]);
    expect(keysOf(sweeps[1])[0]).toBe(playbookNamed(playbooksInASweep));
  });

  it('sweep again at once while the read of what was appended stopped at its most', async () => {
    const appended: AppendedStreams = { streams: ['playbook/acme/alpha/events/'], through: ['15'], more: true };

    const { sweeps } = await sweptOver({ appended: [now, appended] }, 1);

    expect(sweeps[0]?.again).toBe(true);
  });
});

function answering(answers: readonly AppendedStreams[]) {
  const reads = { count: 0 };
  return {
    readAppended: () => {
      const answer = answers[Math.min(reads.count, answers.length - 1)] ?? now;
      reads.count += 1;
      return Promise.resolve(answer);
    },
  };
}

function followingFailingOnce(): FollowedPlaybooks {
  const failures = { left: 1 };
  return {
    ...followedOf({ appended: [] }),
    following: () =>
      Effect.suspend(() => {
        failures.left -= 1;
        return failures.left < 0 ? Effect.succeed([]) : Effect.die(new Error('The playbooks could not be read'));
      }),
  };
}

const quiet: AppendedStreams = { streams: [], through: ['30'], more: false };

function loadOf(sweep: number): AppendedStreams {
  return {
    streams: Array.from({ length: 200 }, (_, index) => `playbook/acme/s${sweep}b${index}/events/`),
    through: [String(sweep)],
    more: false,
  };
}

describe('the sweeps of the follower when a read fails', () => {
  it('keep the playbooks they chose when the read of the round fails, and hand them out at the next sweep', async () => {
    const appended: AppendedStreams = { streams: ['playbook/acme/alpha/events/'], through: ['20'], more: false };
    const playbookSweeps = playbookSweepsOn(answering([now, appended, quiet]), followingFailingOnce());
    await Effect.runPromise(playbookSweeps.started());

    const failed = await Effect.runPromiseExit(playbookSweeps.next());
    const next = await Effect.runPromise(playbookSweeps.next());

    expect(Exit.isFailure(failed)).toBe(true);
    expect(keysOf(next)).toEqual(['playbook/acme/alpha/']);
  });

  it('name a registry again at every sweep until it was read', async () => {
    const appended: AppendedStreams = { streams: ['org/acme/playbooks'], through: ['20'], more: false };
    const playbookSweeps = playbookSweepsOn(answering([now, appended, quiet]), followedOf({ appended: [] }));
    await Effect.runPromise(playbookSweeps.started());

    const first = await Effect.runPromise(playbookSweeps.next());
    const unread = await Effect.runPromise(playbookSweeps.next());
    playbookSweeps.registriesRead(unread.registries);
    const read = await Effect.runPromise(playbookSweeps.next());

    expect([first.registries, unread.registries, read.registries]).toEqual([
      ['org/acme/playbooks'],
      ['org/acme/playbooks'],
      [],
    ]);
  });
});

describe('the sweeps of the follower under a steady load', () => {
  it('pass a failed playbook within a few sweeps though 200 playbooks are appended to before each', async () => {
    const loads = Array.from({ length: 8 }, (_, sweep) => loadOf(sweep));
    const playbookSweeps = playbookSweepsOn(answering(loads), followedOf({ appended: [] }));
    await Effect.runPromise(playbookSweeps.started());
    await Effect.runPromise(playbookSweeps.next());
    playbookSweeps.passAgain('playbook/acme/failed/');

    const sweeps = await Effect.runPromise(Effect.forEach(Array.from({ length: 5 }), () => playbookSweeps.next()));
    const passedAt = sweeps.findIndex((sweep) => keysOf(sweep).includes('playbook/acme/failed/'));

    expect(passedAt).toBeGreaterThanOrEqual(0);
    expect(passedAt).toBeLessThan(3);
  });
});
