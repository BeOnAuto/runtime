import { streamSignalOf } from '@on.auto/ledger';
import { messageIdOf } from '@on.auto/operations';
import { type RecordedSpan, recordingTracer } from '@on.auto/operations/testing';
import { Cause, Context, Deferred, Effect, Exit, Function, Tracer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { systemClock } from '../loop/host-clock.ts';
import type { HostWakeUp, NextWake } from '../loop/host-wake-up.ts';
import { followedRecordOf } from '../reaction-testing/followed-records.ts';
import type { MovingTime } from '../reaction-testing/follower-parts.ts';
import {
  alpha,
  byAdmin,
  childStarted,
  childStreamOf,
  definitionRecorded,
  definitionStreamNamed,
  eventTrigger,
  published,
  recorded,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import type { Sweep } from '../sweeps/org-sweeps.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';
import { followedThroughTheLatest, type Resting } from '../waiting-testing/followed-host.ts';
import { parentId, waitingParent } from '../waiting-testing/waiting-parent.ts';
import {
  type BoundConsumer,
  boundTo,
  type Consumer,
  type Delivery,
  DeliveryFailed,
  type RecordConsumer,
} from './consumers.ts';
import { deliveredAll } from './delivery-loop.ts';
import { followedOrgsOn, type HeldPlaybook, type Progress } from './followed-orgs.ts';
import { followerWakeUpOf, type FollowerWork, type Upkeep } from './follower-wake-up.ts';

const followed = followedRecordOf(null);

const fresh: Progress = { cursor: null, delivered: null, attempts: 0, waiting: false };

interface Counted {
  readonly consumer: RecordConsumer;
  readonly delivered: () => readonly string[];
  readonly skipped: () => readonly string[];
}

function boundAll(...consumers: readonly RecordConsumer[]) {
  return consumers.map((consumer) => boundTo(consumer, followed));
}

function keyed(index: number): string {
  return String(index).padStart(4, '0');
}

interface CountedOptions {
  readonly failing?: ReadonlySet<string>;
  readonly delivers?: (key: string) => boolean;
  readonly held?: ReadonlySet<string>;
}

function counted(
  name: string,
  count: number,
  { failing = new Set(), delivers = () => true, held = new Set() }: CountedOptions = {},
): Counted {
  const delivered: string[] = [];
  const skipped: string[] = [];
  const failed = (key: string) =>
    held.has(key)
      ? new DeliveryFailed({ detail: `${key} waits for the content store`, held: 'content' })
      : new DeliveryFailed({ detail: `${key} failed` });
  const deliveryOf = (key: string): Delivery => ({
    key,
    workflow: 'close',
    deliver: failing.has(key)
      ? Effect.fail(failed(key))
      : Effect.sync(() => {
          delivered.push(`${name} ${key}`);
        }),
    skipped: ({ detail }) =>
      Effect.sync(() => {
        skipped.push(`${key}: ${detail}`);
      }),
  });
  const keys = Array.from({ length: count }, (_, index) => keyed(index));
  return {
    consumer: {
      name,
      skippedAfterSweeps: 20,
      batchOf: (_record, after, most) =>
        Effect.sync(() => {
          const left = keys.filter((key) => after === undefined || key > after);
          const taken = left.slice(0, most);
          return {
            deliveries: taken.filter((key) => delivers(key)).map((key) => deliveryOf(key)),
            through: taken.at(-1),
            more: left.length > most,
          };
        }),
    },
    delivered: () => delivered,
    skipped: () => skipped,
  };
}

const waiting = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const childStream = childStreamOf(child);

function handedTheChildsEnding({ name, attributes, ending }: RecordedSpan): boolean {
  return name === 'follow run_succeeded' && attributes['auto.on.stream'] === childStream && ending === 'succeeded';
}

const ofTheChild = {
  by: 'playbook:alpha',
  at: '2026-10-01T09:00:00.000Z',
  runId: child,
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy: { runId: parentId, reference: '/do/0/ask', run: 1 },
};

async function deliveredAgain(
  database: Parameters<typeof followedOrgsOn>[0],
  host: Resting,
  again: () => boolean,
  nudges = 0,
): Promise<void> {
  await followedThroughTheLatest(database, host);
  if (again()) {
    return;
  }
  await Effect.runPromise(
    followedOrgsOn(database).save('acme', { cursor: null, delivered: null, attempts: 0, waiting: false }),
  );
  await published(database.store, { id: `nudge-${nudges + 1}`, type: 'com.acme.c' });
  await deliveredAgain(database, host, again, nudges + 1);
}

const handingOutAcme: Sweep = { orgs: [{ org: 'acme', known: undefined }], again: false };

const parkedAlpha: HeldPlaybook = {
  playbookKey: 'playbook/acme/alpha/',
  org: 'acme',
  progress: { cursor: 'c-1', delivered: null, attempts: 3, waiting: false },
  hold: { heldFor: 'delivery', since: 1, until: 1, holds: 3 },
};

interface Logging {
  readonly atStart?: Effect.Effect<void>;
  readonly parked?: readonly HeldPlaybook[];
}

function wakeUpLogging({ atStart = Effect.void, parked = [] }: Logging) {
  const log: string[] = [];
  const logged = (line: string) =>
    Effect.sync(() => {
      log.push(line);
    });
  const work: FollowerWork = {
    passes: {
      org: (org, mode) => Effect.as(logged(`pass ${org} ${mode}`), 'caught_up'),
      held: ({ playbookKey }) => Effect.as(logged(`try ${playbookKey}`), 'caught_up'),
    },
    discovery: { atStart: () => Effect.andThen(logged('start'), atStart), orgSeen: () => Effect.void },
    sweeps: {
      started: () => logged('anchored'),
      next: () => Effect.as(logged('next sweep'), handingOutAcme),
      passAgain: Function.constVoid,
    },
    upkeep: {
      sweep: () => logged('sweep'),
      fireSchedules: () => Effect.void,
      nextScheduleAt: () => Effect.succeed(null),
      nextDeferredAt: () => Effect.succeed(null),
    },
    appended: streamSignalOf(),
    holds: {
      heldAt: () => Effect.succeed({ due: [], nextAt: null }),
      parkedForDelivery: () => Effect.succeed(parked),
      failed: () => Effect.void,
    },
    rounds: { failed: () => Effect.succeed(60_000), succeeded: () => Effect.void },
    clock: systemClock,
    sweepEveryMs: 1000,
    trouble: (what) => logged(what),
  };
  const wake = followerWakeUpOf(work, { raised: Function.constVoid, renewed: Function.constVoid });
  onTestFinished(() => Effect.runPromise(wake.stop()));
  return { wake, log: () => log };
}

const nothingToSweep: Sweep = { orgs: [], again: false };

const at = Date.parse('2026-11-11T09:00:00.000Z');

const signal = { raised: Function.constVoid, renewed: Function.constVoid };

const unreadStarts = new Error('The starts that wait could not be read');

const unreadSchedules = new Error('The schedules could not be read');

const firingBroke = new Error('The schedules broke');

const holdsBroke = new Error('The held playbooks could not be read');

const startBroke = new Error('The playbooks could not be found');

interface Due {
  readonly scheduleAt: number | null | 'unread';
  readonly heldAt: number | null;
  readonly deferredAt: number | null | 'unread';
}

type BreaksAt = 'nowhere' | 'firing' | 'holds';

interface WorkDue {
  readonly work: FollowerWork;
  readonly troubles: () => readonly unknown[];
  readonly passes: () => readonly string[];
}

function roundsAMinuteLongerEachInARow(): FollowerWork['rounds'] {
  const failed = { inARow: 0 };
  return {
    failed: () =>
      Effect.sync(() => {
        failed.inARow += 1;
        return failed.inARow * 60_000;
      }),
    succeeded: () =>
      Effect.sync(() => {
        failed.inARow = 0;
      }),
  };
}

function workDue({ scheduleAt, heldAt, deferredAt }: Due, broken: Readonly<{ at: BreaksAt }>): WorkDue {
  const troubles: unknown[] = [];
  const passes: string[] = [];
  const work: FollowerWork = {
    passes: {
      org: (org, mode) =>
        Effect.sync(() => {
          passes.push(`${org} ${mode}`);
          return 'caught_up';
        }),
      held: () => Effect.succeed('caught_up'),
    },
    discovery: { atStart: () => Effect.void, orgSeen: () => Effect.void },
    sweeps: {
      started: () => Effect.void,
      next: () => Effect.succeed(nothingToSweep),
      passAgain: Function.constVoid,
    },
    upkeep: {
      sweep: () => Effect.void,
      fireSchedules: () => (broken.at === 'firing' ? Effect.die(firingBroke) : Effect.void),
      nextScheduleAt: () => (scheduleAt === 'unread' ? Effect.die(unreadSchedules) : Effect.succeed(scheduleAt)),
      nextDeferredAt: () => (deferredAt === 'unread' ? Effect.die(unreadStarts) : Effect.succeed(deferredAt)),
    },
    appended: streamSignalOf(),
    holds: {
      heldAt: () => (broken.at === 'holds' ? Effect.die(holdsBroke) : Effect.succeed({ due: [], nextAt: heldAt })),
      parkedForDelivery: () => Effect.succeed([]),
      failed: () => Effect.void,
    },
    rounds: roundsAMinuteLongerEachInARow(),
    clock: { now: () => at, sleep: () => Effect.void },
    sweepEveryMs: 1000,
    trouble: (_what, cause) =>
      Effect.sync(() => {
        troubles.push(Cause.squash(cause));
      }),
  };
  return { work, troubles: () => troubles, passes: () => passes };
}

async function nextDueAfterAStart(due: Due) {
  const { work, troubles } = workDue(due, { at: 'nowhere' });
  const follower = followerWakeUpOf(work, signal);
  onTestFinished(() => Effect.runPromise(follower.stop()));
  const { nextDueAt } = await Effect.runPromise(follower.wakeUp({ now: at, sweep: true }));
  return { nextDueAt, troubles: troubles() };
}

const retriedAfterTheFirstRoundThatFailed = at + 1 + 60_000;

async function nextDueAfterARoundThatFailed(due: Due, breaksAt: BreaksAt) {
  const broken: { at: BreaksAt } = { at: 'nowhere' };
  const { work, troubles } = workDue(due, broken);
  const follower = followerWakeUpOf(work, signal);
  onTestFinished(() => Effect.runPromise(follower.stop()));
  await Effect.runPromise(follower.wakeUp({ now: at, sweep: true }));
  const troublesBefore = troubles().length;
  broken.at = breaksAt;
  const { nextDueAt } = await Effect.runPromise(follower.wakeUp({ now: at + 1, sweep: true }));
  return { nextDueAt, troubles: troubles().slice(troublesBefore) };
}

const fiveMinutes = 5 * 60_000;

function movingTimeFrom(start: number): MovingTime {
  const time = { now: start };
  return {
    now: () => time.now,
    moved: (milliseconds) => {
      time.now += milliseconds;
    },
  };
}

interface Scheduled {
  readonly fired: Upkeep['fireSchedules'];
  readonly nextDueAt: Upkeep['nextScheduleAt'];
  readonly firings: () => readonly (readonly number[])[];
}

function everyFiveMinutesFrom(firstDueAt: number, time: MovingTime): Scheduled {
  const schedule = { nextDue: firstDueAt };
  const firings: (readonly number[])[] = [];
  return {
    fired: () =>
      Effect.sync(() => {
        const timesDue = Math.max(0, Math.floor((time.now() - schedule.nextDue) / fiveMinutes) + 1);
        if (timesDue > 0) {
          firings.push(Array.from({ length: timesDue }, (_, index) => schedule.nextDue + index * fiveMinutes));
          schedule.nextDue += timesDue * fiveMinutes;
        }
      }),
    nextDueAt: () => Effect.sync(() => schedule.nextDue),
    firings: () => firings,
  };
}

function wokenAt(follower: HostWakeUp, time: MovingTime, now: number): Promise<NextWake> {
  time.moved(now - time.now());
  return Effect.runPromise(follower.wakeUp({ now, sweep: true }));
}

function startFailing(times: number): FollowerWork['discovery']['atStart'] {
  const failures = { left: times };
  return () =>
    Effect.suspend(() => {
      failures.left -= 1;
      return failures.left < 0 ? Effect.void : Effect.die(startBroke);
    });
}

function readFailingFirst(
  times: number,
  read: () => Effect.Effect<number | null>,
  broken: Readonly<Error>,
): () => Effect.Effect<number | null> {
  const failures = { left: times };
  return () =>
    Effect.suspend(() => {
      failures.left -= 1;
      return failures.left < 0 ? read() : Effect.die(broken);
    });
}

interface StartWaiting {
  readonly swept: Upkeep['sweep'];
  readonly nextDueAt: Upkeep['nextDeferredAt'];
  readonly started: () => readonly number[];
}

function aStartWaitingUntil(dueAt: number, time: MovingTime): StartWaiting {
  const deferred: { dueAt: number | null } = { dueAt };
  const started: number[] = [];
  return {
    swept: () =>
      Effect.sync(() => {
        if (deferred.dueAt !== null && time.now() >= deferred.dueAt) {
          started.push(time.now());
          deferred.dueAt = null;
        }
      }),
    nextDueAt: () => Effect.sync(() => deferred.dueAt),
    started: () => started,
  };
}

interface Span {
  readonly from: number;
  readonly through: number;
}

async function wakesAtItsAnswers(follower: HostWakeUp, time: MovingTime, { from, through }: Span): Promise<number> {
  const { nextDueAt } = await wokenAt(follower, time, from);
  return nextDueAt === null || nextDueAt > through
    ? 1
    : 1 + (await wakesAtItsAnswers(follower, time, { from: nextDueAt, through }));
}

function recordingIds(name: string, types: readonly string[], received: (id: string) => void): Consumer {
  return {
    name,
    types,
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    batchOf: (followedFollowerRecords, after) =>
      Effect.succeed({
        deliveries:
          after === undefined
            ? [
                {
                  key: followedFollowerRecords.event.event.id,
                  workflow: 'archive',
                  deliver: Effect.sync(() => {
                    received(followedFollowerRecords.event.event.id);
                  }),
                  skipped: () => Effect.void,
                },
              ]
            : [],
        through: followedFollowerRecords.event.event.id,
        more: false,
      }),
  };
}

describe('the deliveries of one record', () => {
  it('are 100 in a pass at most, the rest following in the next pass from the last delivered, consumer by consumer', async () => {
    const listeners = counted('listeners', 120);
    const starts = counted('starts', 30);
    const consumers = boundAll(listeners.consumer, starts.consumer);

    const first = await Effect.runPromise(deliveredAll(consumers, fresh, 'signal'));
    const second = await Effect.runPromise(deliveredAll(consumers, first.progress, 'signal'));

    expect([first.end, listeners.delivered().length, second.end, starts.delivered().length]).toEqual([
      'more',
      120,
      undefined,
      30,
    ]);
    expect(listeners.delivered().slice(99, 101)).toEqual(['listeners 0099', 'listeners 0100']);
  });

  it('ask each consumer, an assessor among them, for a batch of at most 100 unless the pass is given another figure', async () => {
    const asked: number[] = [];
    const assessor: BoundConsumer = {
      name: 'assessor',
      skippedAfterSweeps: 20,
      batchOf: (_after, most) =>
        Effect.sync(() => {
          asked.push(most);
          return { deliveries: [], through: undefined, more: false };
        }),
    };

    await Effect.runPromise(deliveredAll([assessor], fresh, 'signal'));
    await Effect.runPromise(deliveredAll([assessor], fresh, 'signal', 3));

    expect(asked).toEqual([100, 3]);
  });

  it('try a delivery that keeps failing on 20 sweeps, holding the record, then skip it and say so', async () => {
    const starts = counted('starts', 3, { failing: new Set(['0001']) });
    const swept = (progress: Progress) => deliveredAll(boundAll(starts.consumer), progress, 'sweep');

    const signalled = await Effect.runPromise(deliveredAll(boundAll(starts.consumer), fresh, 'signal'));
    const held = await Effect.runPromise(
      Array.from({ length: 19 }).reduce<Effect.Effect<Progress>>(
        (before) => Effect.flatMap(before, (progress) => Effect.map(swept(progress), (step) => step.progress)),
        Effect.succeed(signalled.progress),
      ),
    );
    const last = await Effect.runPromise(swept(held));

    expect([signalled.end, signalled.progress.attempts, held.attempts, last.end]).toEqual([
      'waiting',
      0,
      19,
      undefined,
    ]);
    expect([starts.delivered(), starts.skipped()]).toEqual([['starts 0000', 'starts 0002'], ['0001: 0001 failed']]);
  });

  it('ask a consumer again within the pass, from where its last batch ended, while its batches deliver fewer than they take', async () => {
    const sparse = counted('sparse', 298, { delivers: (key) => Number(key) % 3 === 0 });

    const pass = await Effect.runPromise(deliveredAll(boundAll(sparse.consumer), fresh, 'signal'));

    expect([pass.end, sparse.delivered().length, sparse.delivered().at(-1)]).toEqual([undefined, 100, 'sparse 0297']);
  });
});

describe('the deliveries of a record whose consumers changed between two passes', () => {
  it('go on from the first consumer, from its first key, when the consumer the last pass stopped at is no longer among them', async () => {
    const listeners = counted('listeners', 120);
    const starts = counted('starts', 30);
    const endings = counted('endings', 3);

    const first = await Effect.runPromise(deliveredAll(boundAll(listeners.consumer, starts.consumer), fresh, 'signal'));
    const second = await Effect.runPromise(
      deliveredAll(boundAll(endings.consumer, starts.consumer), first.progress, 'signal'),
    );

    expect([first.end, first.progress.delivered, second.end]).toEqual(['more', '["listeners","0099"]', undefined]);
    expect([endings.delivered(), starts.delivered().length]).toEqual([
      ['endings 0000', 'endings 0001', 'endings 0002'],
      30,
    ]);
  });
});

describe('the deliveries of one record while the content store does not answer', () => {
  it('hold a delivery that fails for the content store at its record through any number of sweeps, never counting it nor skipping it', async () => {
    const starts = counted('starts', 3, { failing: new Set(['0001']), held: new Set(['0001']) });
    const swept = (progress: Progress) => deliveredAll(boundAll(starts.consumer), progress, 'sweep');

    const held = await Effect.runPromise(
      Array.from({ length: 40 }).reduce<Effect.Effect<Progress>>(
        (before) => Effect.flatMap(before, (progress) => Effect.map(swept(progress), (step) => step.progress)),
        Effect.succeed(fresh),
      ),
    );

    expect([held.attempts, held.waiting]).toEqual([0, true]);
    expect([starts.delivered(), starts.skipped()]).toEqual([['starts 0000'], []]);
  });
});

describe('a record the follower delivers twice, as a pass that goes on from the first consumer does', () => {
  it('is offered once to a run that listens for it, and its trigger asks again for the run it started under the same id', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [eventTrigger({ type: 'com.acme.a' })] });
    const both =
      'do:\n  - both: { listen: { to: { all: [{ with: { type: com.acme.a } }, { with: { type: com.acme.b } }] } } }';
    await Effect.runPromise(reacting.host.start(runAt(waiting), startOf(workflow(both))));
    await published(store, { id: 'e1', type: 'com.acme.a', data: 'first' });
    await reacting.sweeps.until(
      () => Effect.runPromise(reacting.host.stateOf(runAt(waiting))),
      (state) => state.inbox.received === 1,
      fewSweeps,
    );

    await deliveredAgain(reacting.database, reacting, () => reacting.reactions.starts().length > 1);
    const between = await Effect.runPromise(reacting.host.stateOf(runAt(waiting)));
    await published(store, { id: 'e3', type: 'com.acme.b', data: 'second' });
    const state = await reacting.sweeps.until(
      () => Effect.runPromise(reacting.host.stateOf(runAt(waiting))),
      (found) => found.status === 'ended',
      fewSweeps,
    );
    const runIds = reacting.reactions.starts().map(({ runId }) => runId);

    expect([between.inbox.offeredIds.length, between.inbox.received]).toEqual([1, 1]);
    expect(state.outcome).toEqual({ kind: 'completed', output: ['first', 'second'] });
    expect(state.inbox).toMatchObject({ received: 2 });
    expect(state.inbox.offeredIds).toHaveLength(2);
    expect([runIds.length > 1, new Set(runIds).size]).toEqual([true, 1]);
  });
});

describe('a run ending the follower delivers twice', () => {
  it('answers the call that waits for it once', async () => {
    const recording = recordingTracer();
    const { database, settled, answeredCalls, hosted } = await waitingParent(child, {
      context: Context.make(Tracer.Tracer, recording.tracer),
    });
    const handings = () => recording.spans().filter((span) => handedTheChildsEnding(span)).length;
    await recorded(
      database.store,
      await childStarted(database.store, child, ofTheChild),
      { type: 'run_succeeded', data: { output: 'checked', record: {} } },
      ofTheChild,
    );
    await settled(parentId);

    await deliveredAgain(database, hosted, () => handings() > 1);

    expect(await answeredCalls()).toEqual([{ state: 'answered', delivered: 1 }]);
    expect(hosted.settlements().get(parentId)).toEqual({ status: 'succeeded', output: 'checked' });
    expect(hosted.troubles()).toEqual([]);
  });
});

describe('the wake-up of the follower of the playbooks', () => {
  it('runs one wake at a time: two wakes together take its place once, place the orgs once, sweep once and pass each org once', async () => {
    const finding = Deferred.makeUnsafe<void>();
    const { wake, log } = wakeUpLogging({ atStart: Deferred.await(finding) });
    const woken = { now: Date.now(), sweep: true };

    const together = Promise.all([Effect.runPromise(wake.wakeUp(woken)), Effect.runPromise(wake.wakeUp(woken))]);
    await Effect.runPromise(Deferred.done(finding, Exit.void));
    const answers = await together;

    expect(log()).toEqual(['anchored', 'start', 'next sweep', 'sweep', 'pass acme sweep']);
    expect(answers).toEqual([{ nextDueAt: null }, { nextDueAt: null }]);
  });
});

describe('the playbooks parked for a delivery that waits to be tried again', () => {
  it('are tried at a wake that sweeps, after the orgs it passes, and at no other', async () => {
    const { wake, log } = wakeUpLogging({ parked: [parkedAlpha] });

    await Effect.runPromise(wake.wakeUp({ now: Date.now(), sweep: true }));
    await Effect.runPromise(wake.wakeUp({ now: Date.now(), sweep: false }));

    expect(log()).toEqual(['anchored', 'start', 'next sweep', 'sweep', 'pass acme sweep', 'try playbook/acme/alpha/']);
  });
});

describe('the time the follower is next due, with starts that wait for a later minute', () => {
  it('is the earliest of the next schedule, the next hold and the first start that waits', async () => {
    const answers = await Promise.all([
      nextDueAfterAStart({ scheduleAt: at + 60_000, heldAt: at + 90_000, deferredAt: at + 30_000 }),
      nextDueAfterAStart({ scheduleAt: at + 60_000, heldAt: at + 20_000, deferredAt: at + 30_000 }),
      nextDueAfterAStart({ scheduleAt: at + 10_000, heldAt: at + 90_000, deferredAt: at + 30_000 }),
      nextDueAfterAStart({ scheduleAt: null, heldAt: null, deferredAt: at + 30_000 }),
      nextDueAfterAStart({ scheduleAt: null, heldAt: null, deferredAt: null }),
    ]);

    expect(answers).toEqual(
      [at + 30_000, at + 20_000, at + 10_000, at + 30_000, null].map((nextDueAt) => ({ nextDueAt, troubles: [] })),
    );
  });

  it('is a sweep interval after now while a start that waits is due already, so a wake that did not sweep, or left more due than a sweep takes, is followed by the next sweep and not at once', async () => {
    const answers = await Promise.all([
      nextDueAfterAStart({ scheduleAt: null, heldAt: null, deferredAt: at }),
      nextDueAfterAStart({ scheduleAt: null, heldAt: null, deferredAt: at - 60_000 }),
      nextDueAfterAStart({ scheduleAt: at + 500, heldAt: null, deferredAt: at - 60_000 }),
    ]);

    expect(answers).toEqual([at + 1000, at + 1000, at + 500].map((nextDueAt) => ({ nextDueAt, troubles: [] })));
  });

  it('is the earliest of what was read and a retry a minute after the wake when the starts that wait cannot be read, which is said', async () => {
    const answers = await Promise.all([
      nextDueAfterAStart({ scheduleAt: at + 90_000, heldAt: null, deferredAt: 'unread' }),
      nextDueAfterAStart({ scheduleAt: at + 30_000, heldAt: null, deferredAt: 'unread' }),
      nextDueAfterAStart({ scheduleAt: 'unread', heldAt: at + 20_000, deferredAt: null }),
    ]);

    expect(answers).toEqual([
      { nextDueAt: at + 60_000, troubles: [unreadStarts] },
      { nextDueAt: at + 30_000, troubles: [unreadStarts] },
      { nextDueAt: at + 20_000, troubles: [unreadSchedules] },
    ]);
  });
});

describe('the time the follower is next due after a round that failed', () => {
  it('is as long as the rounds failed in a row answer, though a start that waits is due, since only a round that succeeds takes one up', async () => {
    const broken: { at: BreaksAt } = { at: 'nowhere' };
    const { work } = workDue({ scheduleAt: null, heldAt: null, deferredAt: at }, broken);
    const follower = followerWakeUpOf(work, signal);
    onTestFinished(() => Effect.runPromise(follower.stop()));

    await Effect.runPromise(follower.wakeUp({ now: at, sweep: true }));
    broken.at = 'firing';
    const first = await Effect.runPromise(follower.wakeUp({ now: at + 1, sweep: true }));
    const second = await Effect.runPromise(follower.wakeUp({ now: at + 2, sweep: true }));

    expect([first, second]).toEqual([{ nextDueAt: at + 1 + 60_000 }, { nextDueAt: at + 2 + 120_000 }]);
  });

  it('is the next schedule when it is still to come before the round’s retry, and the retry when the schedule it failed to fire is still due, or the next comes at the retry or after it', async () => {
    const answers = await Promise.all([
      nextDueAfterARoundThatFailed({ scheduleAt: at - 60_000, heldAt: null, deferredAt: null }, 'firing'),
      nextDueAfterARoundThatFailed({ scheduleAt: at + 1, heldAt: null, deferredAt: null }, 'firing'),
      nextDueAfterARoundThatFailed({ scheduleAt: at + 30_000, heldAt: null, deferredAt: null }, 'firing'),
      nextDueAfterARoundThatFailed(
        { scheduleAt: retriedAfterTheFirstRoundThatFailed, heldAt: null, deferredAt: null },
        'firing',
      ),
      nextDueAfterARoundThatFailed({ scheduleAt: at + 90_000, heldAt: null, deferredAt: null }, 'firing'),
    ]);

    expect(answers).toEqual(
      [
        retriedAfterTheFirstRoundThatFailed,
        retriedAfterTheFirstRoundThatFailed,
        at + 30_000,
        retriedAfterTheFirstRoundThatFailed,
        retriedAfterTheFirstRoundThatFailed,
      ].map((nextDueAt) => ({ nextDueAt, troubles: [firingBroke] })),
    );
  });

  it('is the next schedule when the round failed after the schedules fired and the next comes before the retry', async () => {
    const answer = await nextDueAfterARoundThatFailed(
      { scheduleAt: at + 30_000, heldAt: null, deferredAt: null },
      'holds',
    );

    expect(answer).toEqual({ nextDueAt: at + 30_000, troubles: [holdsBroke] });
  });

  it('is the round’s retry when the schedules cannot be read either, which is said beside the round', async () => {
    const answer = await nextDueAfterARoundThatFailed(
      { scheduleAt: 'unread', heldAt: null, deferredAt: null },
      'firing',
    );

    expect(answer).toEqual({
      nextDueAt: retriedAfterTheFirstRoundThatFailed,
      troubles: [firingBroke, unreadSchedules],
    });
  });

  it('is the round’s retry, though the first start that waits comes before it, since only a round that succeeds takes one up', async () => {
    const answer = await nextDueAfterARoundThatFailed(
      { scheduleAt: null, heldAt: null, deferredAt: at + 30_000 },
      'holds',
    );

    expect(answer).toEqual({ nextDueAt: retriedAfterTheFirstRoundThatFailed, troubles: [holdsBroke] });
  });

  it('keeps every time of a schedule through a fault that fails each round after the schedules fired, woken only at the time it answers, as the retries grow past the schedule’s interval', async () => {
    const time = movingTimeFrom(at);
    const schedule = everyFiveMinutesFrom(at + fiveMinutes, time);
    const broken: { at: BreaksAt } = { at: 'nowhere' };
    const { work, troubles } = workDue({ scheduleAt: null, heldAt: null, deferredAt: null }, broken);
    const follower = followerWakeUpOf(
      {
        ...work,
        clock: { now: time.now, sleep: () => Effect.void },
        upkeep: { ...work.upkeep, fireSchedules: schedule.fired, nextScheduleAt: schedule.nextDueAt },
      },
      signal,
    );
    onTestFinished(() => Effect.runPromise(follower.stop()));

    const started = await wokenAt(follower, time, at);
    broken.at = 'holds';
    const wakes = await wakesAtItsAnswers(follower, time, {
      from: Number(started.nextDueAt),
      through: at + 12 * fiveMinutes,
    });

    expect(schedule.firings()).toEqual(Array.from({ length: 12 }, (_, index) => [at + (index + 1) * fiveMinutes]));
    expect([started, troubles().length, new Set(troubles())]).toEqual([
      { nextDueAt: at + fiveMinutes },
      wakes,
      new Set([holdsBroke]),
    ]);
  });

  it('is the round’s retry, though a playbook was signalled that the round failed before passing, and the round tried again passes it', async () => {
    const broken: { at: BreaksAt } = { at: 'nowhere' };
    const { work, passes } = workDue({ scheduleAt: null, heldAt: null, deferredAt: null }, broken);
    const follower = followerWakeUpOf(work, signal);
    onTestFinished(() => Effect.runPromise(follower.stop()));

    await Effect.runPromise(follower.wakeUp({ now: at, sweep: true }));
    broken.at = 'firing';
    work.appended.raise(`${alpha}events/e1`);
    const failed = await Effect.runPromise(follower.wakeUp({ now: at + 1, sweep: false }));
    broken.at = 'nowhere';
    const retried = await Effect.runPromise(
      follower.wakeUp({ now: retriedAfterTheFirstRoundThatFailed, sweep: false }),
    );

    expect([failed, retried]).toEqual([{ nextDueAt: retriedAfterTheFirstRoundThatFailed }, { nextDueAt: null }]);
    expect(passes()).toEqual(['acme signal']);
  });
});

describe('the time the follower is next due after a start that failed', () => {
  it('is the start’s retry, so a follower woken only at the times it answers finds the playbooks again then and fires the schedule due after it', async () => {
    const time = movingTimeFrom(at);
    const schedule = everyFiveMinutesFrom(at + fiveMinutes, time);
    const { work, troubles } = workDue({ scheduleAt: null, heldAt: null, deferredAt: null }, { at: 'nowhere' });
    const follower = followerWakeUpOf(
      {
        ...work,
        discovery: { ...work.discovery, atStart: startFailing(1) },
        clock: { now: time.now, sleep: () => Effect.void },
        upkeep: { ...work.upkeep, fireSchedules: schedule.fired, nextScheduleAt: schedule.nextDueAt },
      },
      signal,
    );
    onTestFinished(() => Effect.runPromise(follower.stop()));

    const wakes = await wakesAtItsAnswers(follower, time, { from: at, through: at + fiveMinutes });

    expect([wakes, schedule.firings(), troubles()]).toEqual([3, [[at + fiveMinutes]], [startBroke]]);
  });

  it('is as long as the starts failed in a row answer and never a time already past, though work is due and a playbook was signalled, the start tried again at a wake that sweeps or comes at the retry', async () => {
    const due = { scheduleAt: at - 60_000, heldAt: at - 60_000, deferredAt: at - 60_000 };
    const { work, troubles } = workDue(due, { at: 'nowhere' });
    const follower = followerWakeUpOf(
      { ...work, discovery: { ...work.discovery, atStart: startFailing(Number.POSITIVE_INFINITY) } },
      signal,
    );
    onTestFinished(() => Effect.runPromise(follower.stop()));
    const wokenWith = (now: number, sweep: boolean) => Effect.runPromise(follower.wakeUp({ now, sweep }));

    const first = await wokenWith(at, true);
    work.appended.raise(`${alpha}events/e1`);
    const beforeTheRetry = await wokenWith(at + 30_000, false);
    const atTheRetry = await wokenWith(at + 60_000, false);
    const swept = await wokenWith(at + 61_000, true);

    expect([first, beforeTheRetry, atTheRetry, swept]).toEqual(
      [at + 60_000, at + 60_000, at + 180_000, at + 241_000].map((nextDueAt) => ({ nextDueAt })),
    );
    expect(troubles()).toEqual([startBroke, startBroke, startBroke]);
  });
});

describe('the time the follower is next due after a read of it that failed', () => {
  it('is a retry when the schedules could not be read, so a follower woken only at the times it answers reads them again then and fires the next at its time', async () => {
    const time = movingTimeFrom(at);
    const schedule = everyFiveMinutesFrom(at + fiveMinutes, time);
    const { work, troubles } = workDue({ scheduleAt: null, heldAt: null, deferredAt: null }, { at: 'nowhere' });
    const follower = followerWakeUpOf(
      {
        ...work,
        clock: { now: time.now, sleep: () => Effect.void },
        upkeep: {
          ...work.upkeep,
          fireSchedules: schedule.fired,
          nextScheduleAt: readFailingFirst(1, schedule.nextDueAt, unreadSchedules),
        },
      },
      signal,
    );
    onTestFinished(() => Effect.runPromise(follower.stop()));

    const wakes = await wakesAtItsAnswers(follower, time, { from: at, through: at + fiveMinutes });

    expect([wakes, schedule.firings(), troubles()]).toEqual([3, [[at + fiveMinutes]], [unreadSchedules]]);
  });

  it('is a retry when the starts that wait could not be read, so a follower woken only at the times it answers takes up the first at its minute', async () => {
    const time = movingTimeFrom(at);
    const deferred = aStartWaitingUntil(at + fiveMinutes, time);
    const { work, troubles } = workDue({ scheduleAt: null, heldAt: null, deferredAt: null }, { at: 'nowhere' });
    const follower = followerWakeUpOf(
      {
        ...work,
        clock: { now: time.now, sleep: () => Effect.void },
        upkeep: {
          ...work.upkeep,
          sweep: deferred.swept,
          nextDeferredAt: readFailingFirst(1, deferred.nextDueAt, unreadStarts),
        },
      },
      signal,
    );
    onTestFinished(() => Effect.runPromise(follower.stop()));

    const wakes = await wakesAtItsAnswers(follower, time, { from: at, through: at + fiveMinutes });

    expect([wakes, deferred.started(), troubles()]).toEqual([3, [at + fiveMinutes], [unreadStarts]]);
  });

  it('is the round’s retry alone after a round that failed, a read that failed beside it neither waking the follower sooner nor counted in a row', async () => {
    const time = movingTimeFrom(at);
    const broken: { at: BreaksAt } = { at: 'nowhere' };
    const { work, troubles } = workDue({ scheduleAt: 'unread', heldAt: null, deferredAt: null }, broken);
    const follower = followerWakeUpOf({ ...work, clock: { now: time.now, sleep: () => Effect.void } }, signal);
    onTestFinished(() => Effect.runPromise(follower.stop()));

    const readFailed = await wokenAt(follower, time, at);
    broken.at = 'holds';
    const roundFailed = await wokenAt(follower, time, at + 60_000);
    broken.at = 'nowhere';
    const readFailedAgain = await wokenAt(follower, time, at + 120_000);

    expect([readFailed, roundFailed, readFailedAgain]).toEqual(
      [at + 60_000, at + 120_000, at + 240_000].map((nextDueAt) => ({ nextDueAt })),
    );
    expect(troubles()).toEqual([unreadSchedules, holdsBroke, unreadSchedules, unreadSchedules]);
  });
});

describe('a record of a playbook the follower cannot read', () => {
  it('is said and passed over, as an event, a fact of a run or a definition, while a workflow of the playbook reacts to its type', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    const trigger = eventTrigger(
      { type: 'com.acme.sentinel' },
      { type: 'run_started' },
      { type: 'definition_created' },
    );
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [trigger] });
    await recorded(store, `${alpha}events/bad`, { type: 'event_published', data: { event: 'not an event' } });
    await recorded(store, `${alpha}runs/r-bad`, {
      type: 'run_started',
      data: { input: {}, calls_tools: 7 },
    });
    await recorded(
      store,
      definitionStreamNamed('watch'),
      { type: 'definition_updated', data: { content: 7 } },
      { ...byAdmin, definitionType: 'workflow', definitionName: 'watch', definitionVersion: 2 },
    );

    await published(store, { id: 's1', type: 'com.acme.sentinel' });
    await reacting.sweeps.until(
      () => Promise.resolve(reacting.reactions.starts()),
      (starts) => starts.some(({ cause }) => cause === messageIdOf(`${alpha}events/s1`, 1)),
      fewSweeps,
    );

    expect(reacting.notes()).toMatchObject([
      { kind: 'record_unreadable', org: 'acme', playbook: 'alpha', type: 'event_published' },
      { kind: 'record_unreadable', org: 'acme', playbook: 'alpha', type: 'run_started' },
      { kind: 'record_unreadable', org: 'acme', playbook: 'alpha', type: 'definition_updated' },
    ]);
  });
});

describe('a record the consumers of waiting calls cannot read', () => {
  it('is said once and passed over, a cancel request whose context names no run as an ending whose context names none', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await definitionRecorded(store, {
      name: 'watch',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.sentinel' })],
    });
    const stream = `${alpha}runs/r-bad`;
    await recorded(store, stream, { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Gone' } });
    await recorded(store, stream, { type: 'run_succeeded', data: { output: null, record: {} } });

    await published(store, { id: 's1', type: 'com.acme.sentinel' });
    await reacting.sweeps.until(
      () => Promise.resolve(reacting.reactions.starts()),
      (starts) => starts.some(({ cause }) => cause === messageIdOf(`${alpha}events/s1`, 1)),
      fewSweeps,
    );

    expect(reacting.notes()).toEqual([
      {
        kind: 'record_unreadable',
        org: 'acme',
        playbook: 'alpha',
        recordId: messageIdOf(stream, 1),
        type: 'run_cancel_requested',
      },
      {
        kind: 'record_unreadable',
        org: 'acme',
        playbook: 'alpha',
        recordId: messageIdOf(stream, 2),
        type: 'run_succeeded',
      },
    ]);
  });
});

describe('a consumer the host is given', () => {
  it('is offered the events of the types it names, though nothing in the playbook reacts, and one naming none is offered nothing', async () => {
    const received: string[] = [];
    const record = (id: string) => {
      received.push(id);
    };
    const noting = recordingIds('noting', ['com.acme.noted'], record);
    const wantingNothing = recordingIds('nothing', [], record);
    const reacting = await reactingHost({ consumers: [noting, wantingNothing] });

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.noted' });
    await published(reacting.database.store, { id: 'e2', type: 'com.acme.other' });
    await published(reacting.database.store, { id: 'e3', type: 'com.acme.noted' });
    const delivered = await reacting.sweeps.until(
      () => Promise.resolve<readonly string[]>([...received]),
      (ids) => ids.length >= 2,
      fewSweeps,
    );

    expect(delivered).toEqual(['e1', 'e3']);
  });
});
