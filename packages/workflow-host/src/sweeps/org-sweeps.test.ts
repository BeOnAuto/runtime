import { streamSignalOf, type AppendedStreams } from '@on.auto/ledger';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FollowedOrg, FollowedOrgs } from '../follower/followed-orgs.ts';
import {
  playbookCreated,
  byAdmin,
  definitionRecorded,
  eventTrigger,
  published,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { orgSweepsOn, orgsInASweep, waitingInASweep, type Sweep } from './org-sweeps.ts';

interface Swept {
  readonly sweeps: readonly Sweep[];
  readonly readsAfter: readonly (readonly string[] | undefined)[];
}

interface Ledger {
  readonly appended: readonly AppendedStreams[];
  readonly waiting?: readonly FollowedOrg[];
  readonly followed?: readonly FollowedOrg[];
}

function orgNamed(index: number): string {
  return `o${String(index).padStart(4, '0')}`;
}

function followedOrg(org: string, waiting: boolean): FollowedOrg {
  return { org, cursor: null, delivered: null, attempts: 0, waiting };
}

function orgsNumbered(count: number, waiting: boolean): readonly FollowedOrg[] {
  return Array.from({ length: count }, (_, index) => followedOrg(orgNamed(index), waiting));
}

function followedOf({ waiting = [], followed = [] }: Ledger): FollowedOrgs {
  return {
    follow: () => Effect.void,
    load: () => Effect.die(new Error('The sweeps load no org')),
    save: () => Effect.void,
    heldIn: () => Effect.succeed(new Set()),
    parked: () => Effect.void,
    held: () => Effect.void,
    lifted: () => Effect.void,
    heldAt: () => Effect.succeed({ due: [], nextAt: null }),
    parkedForDelivery: () => Effect.succeed([]),
    waitingForASweep: (limit) => Effect.succeed(waiting.slice(0, limit)),
    following: (after, limit) => Effect.succeed(followed.filter(({ org }) => org > after).slice(0, limit)),
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
  const orgSweeps = orgSweepsOn(store, followedOf(ledger));
  await Effect.runPromise(orgSweeps.started());
  const swept = await Effect.runPromise(Effect.forEach(Array.from({ length: sweeps }), () => orgSweeps.next()));
  return { sweeps: swept, readsAfter };
}

function orgsOf(sweep: Sweep | undefined): readonly string[] {
  return (sweep?.orgs ?? []).map(({ org }) => org);
}

const now: AppendedStreams = { streams: [], through: ['10'], more: false };

const triage = 'definition/globex/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/';

describe('the sweeps of the follower', () => {
  it("hand out once each org one of whose playbooks or definitions was appended to since the last read, read from the stream's name, but not one only a run's log or the org's own streams were appended to", async () => {
    const appended: AppendedStreams = {
      streams: [
        'playbook/acme/alpha/events/',
        `${triage}runs/`,
        'playbook/acme/beta/definitions/',
        'playbook/initech/beta/run-logs/',
        'definition/umbrella/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/run-logs/',
        'org/hooli/playbooks',
        'org/hooli/keys/k1',
        'workflow/elsewhere',
      ],
      through: ['20'],
      more: false,
    };

    const { sweeps, readsAfter } = await sweptOver({ appended: [now, appended] }, 2);

    expect(sweeps).toEqual([
      {
        orgs: [
          { org: 'acme', known: undefined },
          { org: 'globex', known: undefined },
        ],
        again: false,
      },
      { orgs: [], again: false },
    ]);
    expect(readsAfter).toEqual([undefined, ['10'], ['20']]);
  });

  it('keep half of a sweep for orgs that wait, and the rest for orgs appended to, the others at the next sweep', async () => {
    const changed = Array.from(
      { length: 100 },
      (_, index) => `playbook/c${String(index).padStart(4, '0')}/alpha/events/`,
    );
    const appended: AppendedStreams = { streams: changed, through: ['20'], more: false };

    const { sweeps } = await sweptOver({ appended: [now, appended], waiting: orgsNumbered(200, true) }, 2);

    expect(sweeps.map((sweep) => [sweep.orgs.length, sweep.again])).toEqual([
      [orgsInASweep, true],
      [waitingInASweep + 36, false],
    ]);
    expect(sweeps[0]?.orgs.filter(({ known }) => known?.waiting === true)).toHaveLength(waitingInASweep);
    expect(orgsOf(sweeps[1]).at(-1)).toBe('c0099');
  });
});

describe('the sweeps of the follower after its start', () => {
  it('go once over every org followed at their start, as many at a sweep as there is room for', async () => {
    const { sweeps } = await sweptOver({ appended: [now], followed: orgsNumbered(200, false) }, 3);

    expect(sweeps.map((sweep) => sweep.orgs.length)).toEqual([orgsInASweep, 200 - orgsInASweep, 0]);
    expect(orgsOf(sweeps[1])[0]).toBe(orgNamed(orgsInASweep));
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

function followingFailingOnce(): FollowedOrgs {
  const failures = { left: 1 };
  return {
    ...followedOf({ appended: [] }),
    following: () =>
      Effect.suspend(() => {
        failures.left -= 1;
        return failures.left < 0 ? Effect.succeed([]) : Effect.die(new Error('The orgs could not be read'));
      }),
  };
}

const quiet: AppendedStreams = { streams: [], through: ['30'], more: false };

function loadOf(sweep: number): AppendedStreams {
  return {
    streams: Array.from({ length: 200 }, (_, index) => `playbook/s${sweep}o${index}/alpha/events/`),
    through: [String(sweep)],
    more: false,
  };
}

describe('the sweeps of the follower when a read fails', () => {
  it('keep the orgs they chose when the read of the round fails, and hand them out at the next sweep', async () => {
    const appended: AppendedStreams = { streams: ['playbook/acme/alpha/events/'], through: ['20'], more: false };
    const orgSweeps = orgSweepsOn(answering([now, appended, quiet]), followingFailingOnce());
    await Effect.runPromise(orgSweeps.started());

    const failed = await Effect.runPromiseExit(orgSweeps.next());
    const next = await Effect.runPromise(orgSweeps.next());

    expect(Exit.isFailure(failed)).toBe(true);
    expect(orgsOf(next)).toEqual(['acme']);
  });
});

describe('the sweeps of the follower under a steady load', () => {
  it('pass a failed org within a few sweeps though 200 orgs are appended to before each', async () => {
    const loads = Array.from({ length: 8 }, (_, sweep) => loadOf(sweep));
    const orgSweeps = orgSweepsOn(answering(loads), followedOf({ appended: [] }));
    await Effect.runPromise(orgSweeps.started());
    await Effect.runPromise(orgSweeps.next());
    orgSweeps.passAgain('failed');

    const sweeps = await Effect.runPromise(Effect.forEach(Array.from({ length: 5 }), () => orgSweeps.next()));
    const passedAt = sweeps.findIndex((sweep) => orgsOf(sweep).includes('failed'));

    expect(passedAt).toBeGreaterThanOrEqual(0);
    expect(passedAt).toBeLessThan(3);
  });
});

const beta = 'playbook/acme/beta/';

const closed = eventTrigger({ type: 'com.acme.closed' });

function startsReaching(reacting: ReactingHost, count: number) {
  return reacting.whenRead(
    () => Promise.resolve(reacting.reactions.starts()),
    (starts) => starts.length >= count,
  );
}

describe('the playbooks another process writes to, which raises no signal here', () => {
  it('passes a playbook it followed at its start at the sweep after the playbook was appended to', async () => {
    const settings = await onSQLite();
    const { store } = await openedOn(settings);
    await playbookCreated(store, 'alpha');
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] });
    const reacting = await reactingHost({ settings, appended: streamSignalOf(), sweepEveryMs: 20 });

    await published(store, { id: 'after', type: 'com.acme.closed' });
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ playbook, workflow }) => [playbook, workflow])).toEqual([['alpha', 'close']]);
  });

  it('follows a playbook its org creates from its first record, read from the registry the sweep names', async () => {
    const reacting = await reactingHost({ appended: streamSignalOf(), sweepEveryMs: 20 });
    const { store } = reacting.database;

    await playbookCreated(store, 'beta');
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] }, beta);
    await published(store, { id: 'first', type: 'com.acme.closed' }, byAdmin, beta);
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ playbook, workflow }) => [playbook, workflow])).toEqual([['beta', 'close']]);
  });
});
