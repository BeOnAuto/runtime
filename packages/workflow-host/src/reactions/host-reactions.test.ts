import { statement } from '@on.auto/ledger';
import { recordingTracer } from '@on.auto/operations/testing';
import { callKeyText, type RunInput } from '@on.auto/workflow-engine';
import { Effect, Function, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { type HostDatabase, rowsOf, WholeNumber } from '../database/host-database.ts';
import { filterStops } from '../filtering/filter-matching.ts';
import { callConsumerOf, deliverySweeps, type Consumer } from '../follower/consumers.ts';
import {
  closeHostParts,
  followerWakeUp,
  type HostWakeUp,
  type NextWake,
  openHostParts,
  openWorkflowStore,
  type WakeSignal,
} from '../index.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { type HostClock, systemClock } from '../loop/host-clock.ts';
import { subscribed } from '../reaction-testing/event-subscriptions.ts';
import { followedRecordOf } from '../reaction-testing/followed-records.ts';
import {
  byAdmin,
  definitionKeyNamed,
  definitionRecorded,
  eventTrigger,
  published,
  publishedInTurn,
  recorded,
} from '../reaction-testing/playbook-writes.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { aSQLiteFile, connectedOn, onSQLite, openedOn } from '../testing/host-files.ts';
import { recordedOptionsOf } from '../testing/host-runs.ts';
import { type MeasuredReads, readingMeasured } from '../waiting-testing/measured-reads.ts';
import { reactionConsumersOf } from './reaction-consumers.ts';
import { type ReactionStart, type StartReaction, StartRefused } from './reaction-options.ts';
import { reactionsStreamOf, type Refusal, refusalsOn } from './refusals.ts';
import { mostStartsAMinute, startingOn } from './start-rates.ts';

const playbookKey = 'playbook/acme/alpha/';

const minute = Date.parse('2026-10-01T09:00:00.000Z');

const aMinute = 60_000;

const trace = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' };

const CountRow = Schema.Struct({ count: WholeNumber });

function startNumber(index: number): ReactionStart {
  return {
    org: 'acme',
    playbook: 'alpha',
    definitionKey: 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-0000000c105e/',
    workflow: 'close',
    version: 1,
    runId: `run-${index}`,
    input: [],
    depth: 1,
    cause: `record-${index}`,
    trigger: { kind: 'event', reference: '/schedule/on' },
    trace,
  };
}

function aMinuteOfStartsAndOneMore(starting: ReturnType<typeof startingOn>) {
  return Effect.runPromise(
    Effect.forEach(
      Array.from({ length: mostStartsAMinute + 1 }, (_, index) => startNumber(index)),
      (start) => starting.start(playbookKey, start),
      { discard: true },
    ),
  );
}

function startedUnlessUnread(unread: Readonly<{ now: boolean }>): {
  readonly start: StartReaction;
  readonly started: () => readonly string[];
} {
  const startedDeferredStarts: string[] = [];
  return {
    start: (start) =>
      unread.now
        ? Effect.fail(new StartRefused({ detail: 'not read just now', kind: 'content_unavailable' }))
        : Effect.sync(() => {
            startedDeferredStarts.push(start.runId);
          }),
    started: () => startedDeferredStarts,
  };
}

async function deferredCount(database: HostDatabase) {
  const [row] = await Effect.runPromise(
    rowsOf(CountRow, database.read(statement`SELECT count(*) AS count FROM workflow_reaction_backlog`)),
  );
  return row?.count;
}

const sweepEveryMs = 1000;

function earliestOf(one: number | null, other: number | null): number | null {
  return one === null ? other : Math.min(one, other ?? one);
}

interface OneAlarm {
  readonly clock: HostClock;
  readonly signal: WakeSignal;
  readonly rung: (follower: HostWakeUp, rings: number) => Promise<void>;
  readonly rungAt: () => readonly number[];
}

function oneAlarmFrom(start: number): OneAlarm {
  const time = { now: start };
  const alarm: { at: number | null; sweptAt: number | null } = { at: start, sweptAt: null };
  const rungAt: number[] = [];
  const rung = async (follower: HostWakeUp, rings: number): Promise<void> => {
    if (alarm.at === null || rings === 0) {
      return;
    }
    time.now = Math.max(time.now, alarm.at);
    const sweep = alarm.sweptAt === null || time.now - alarm.sweptAt >= sweepEveryMs;
    alarm.at = null;
    rungAt.push(time.now);
    const { nextDueAt } = await Effect.runPromise(follower.wakeUp({ now: time.now, sweep }));
    alarm.sweptAt = sweep ? time.now : alarm.sweptAt;
    alarm.at = earliestOf(alarm.at, nextDueAt);
    await rung(follower, rings - 1);
  };
  return {
    clock: { now: () => time.now, sleep: () => Effect.void },
    signal: {
      raised: () => {
        alarm.at = earliestOf(alarm.at, time.now);
      },
      renewed: Function.constVoid,
    },
    rung,
    rungAt: () => rungAt,
  };
}

type Consumers = ReturnType<typeof reactionConsumersOf>;

interface Declining {
  readonly consumers: Consumers;
  readonly offered: readonly RunInput[];
  readonly notes: readonly unknown[];
}

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const runKey = `acme/alpha/${runId}`;

function listening(database: HostDatabase): Promise<void> {
  return Effect.runPromise(
    insertedListener(database, {
      runKey,
      listener: callKeyText({ runId: runKey, reference: '/do/0/wait', run: 1 }),
      playbookKey,
      streamId: `${playbookKey}run-logs/${runId}`,
      armedBy: 1,
      filters: JSON.stringify([{ type: 'go', data: '${ $data.ready === true }' }]),
      workflow: 'waiting',
      version: 1,
      passed: true,
    }),
  );
}

function decliningEveryOffer(database: HostDatabase): Declining {
  const offered: RunInput[] = [];
  const notes: unknown[] = [];
  const consumers = reactionConsumersOf(
    {
      database,
      submitted: (input) =>
        Effect.sync(() => {
          offered.push(input);
          return { outcome: 'stale', version: 2, declined: 'The run took no event of this kind' } as const;
        }),
      clock: { now: () => 0, sleep: () => Effect.void },
      reports: {
        unsettled: () => Effect.void,
        trouble: () => Effect.void,
        note: (note) =>
          Effect.sync(() => {
            notes.push(note);
          }),
      },
    },
    {
      options: recordedReactions().options,
      refusals: { refuse: () => Effect.void, flush: () => Effect.succeed(0) },
      stops: filterStops(),
    },
    { start: () => Effect.void, startDeferred: () => Effect.succeed(0), nextDeferredAt: () => Effect.succeed(null) },
  );
  return { consumers, offered, notes };
}

function named(consumers: Consumers, name: string): Consumers[number] {
  const found = consumers.find((consumer) => consumer.name === name);
  if (found === undefined) {
    throw new Error(`No consumer is named ${name}`);
  }
  return found;
}

const closing = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-0000000c105e/';

const ofClose = { definitionKey: closing, workflow: 'close', version: 3 };

const daily = { kind: 'cron', reference: '/schedule/cron' } as const;

const onEvent = { kind: 'event', reference: '/schedule/on' } as const;

const ofTheDaily = { kind: 'credits_exhausted', because: 'free_daily_limit', trigger: daily } as const;

const ofTheWorkflow = {
  by: 'playbook:alpha',
  definitionType: 'workflow',
  definitionName: 'close',
  definitionVersion: 3,
};

const started = { started_by: { id: 'acme-admin', name: 'acme-admin' }, playbook: 'alpha', input: {} };

const ofTheRun = {
  ...byAdmin,
  runId: 'r-close',
  definitionType: 'workflow',
  definitionName: 'close',
  definitionVersion: 1,
};

function subscriptionStartsOn(database: MeasuredReads['database']) {
  const consumers = reactionConsumersOf(
    {
      database,
      submitted: () => Effect.die('No run is offered an event here'),
      clock: { now: () => 0, sleep: () => Effect.void },
      reports: { unsettled: () => Effect.void, trouble: () => Effect.void, note: () => Effect.void },
    },
    {
      options: recordedReactions().options,
      refusals: { refuse: () => Effect.void, flush: () => Effect.succeed(0) },
      stops: filterStops(),
    },
    { start: () => Effect.void, startDeferred: () => Effect.succeed(0), nextDeferredAt: () => Effect.succeed(null) },
  );
  const starts = consumers.find(({ name }) => name === 'subscription_starts');
  if (starts === undefined) {
    throw new Error('No consumer starts the subscriptions of an event');
  }
  return starts;
}

/** Wakes the follower, one wake after another, until what it has done holds; each wake is a step, not a wait. */
async function wokenUntil<A>(woken: () => Promise<A>, holds: (value: A) => boolean, wakes = 100): Promise<A> {
  const value = await woken();
  if (holds(value) || wakes <= 1) {
    return value;
  }
  return wokenUntil(woken, holds, wakes - 1);
}

describe('the follower of a host composed by a clock of its own', () => {
  it('starts a workflow its trigger matches when it is woken, over parts opened alone, with no loop and no claim', async () => {
    const store = await openWorkflowStore(await connectedOn({ store: 'sqlite', file: aSQLiteFile() }), []);
    const { through: placeAtOpen } = await store.database.store.readAppended(undefined, 0);
    const { options, troubles } = recordedOptionsOf();
    const reactions = recordedReactions();
    const parts = openHostParts(store, { ...options, clock: systemClock }, Function.constVoid);
    const raised = { times: 0 };
    const follower = followerWakeUp(
      { database: store.database, parts, reactions: reactions.options, reports: options.reports, placeAtOpen },
      {
        raised: () => {
          raised.times += 1;
        },
        renewed: Function.constVoid,
      },
    );
    onTestFinished(async () => {
      await Effect.runPromise(follower.stop());
      await closeHostParts(parts);
    });
    const wakeUp = (sweep: boolean): Promise<NextWake> =>
      Effect.runPromise(follower.wakeUp({ now: Date.now(), sweep }));

    const atStart = await wakeUp(true);
    await definitionRecorded(store.database.store, {
      name: 'close',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.closed' })],
    });
    await published(store.database.store, { id: 'e1', type: 'com.acme.closed' });
    const starts = await wokenUntil(
      async () => {
        await wakeUp(false);
        return reactions.starts();
      },
      (found) => found.length > 0,
    );

    expect([atStart, starts.map(({ workflow, depth }) => [workflow, depth]), troubles()]).toEqual([
      { nextDueAt: null },
      [['close', 1]],
      [],
    ]);
    expect(raised.times).toBeGreaterThan(0);
  });
});

function handedTo(note: (name: string) => void, name: string) {
  return (after: string | undefined) =>
    Effect.succeed({
      deliveries:
        after === undefined
          ? [
              {
                key: name,
                workflow: 'close',
                deliver: Effect.sync(() => {
                  note(name);
                }),
                skipped: () => Effect.void,
              },
            ]
          : [],
      through: undefined,
      more: false,
    });
}

describe('the consumers a shell gives the follower', () => {
  it('hands one the events of its types, and one that reads records each record of its types, by the record’s type', async () => {
    const store = await openWorkflowStore(await connectedOn({ store: 'sqlite', file: aSQLiteFile() }), []);
    const { through: placeAtOpen } = await store.database.store.readAppended(undefined, 0);
    const { options } = recordedOptionsOf();
    const parts = openHostParts(store, { ...options, clock: systemClock }, Function.constVoid);
    let names: readonly string[] = [];
    const seen = (name: string) => {
      names = [...names, name];
    };
    const byEvent: Consumer = {
      name: 'by event',
      types: ['com.acme.closed'],
      skippedAfterSweeps: deliverySweeps,
      batchOf: (_followed, after) => handedTo(seen, 'event')(after),
    };
    const byRecord = callConsumerOf({
      name: 'by record',
      types: ['event_published'],
      skippedAfterSweeps: deliverySweeps,
      readOf: (call) => call,
      batchOf: (_call, after) => handedTo(seen, 'record')(after),
    });
    const follower = followerWakeUp(
      {
        database: store.database,
        parts,
        reactions: recordedReactions().options,
        reports: options.reports,
        placeAtOpen,
        consumers: [byEvent, byRecord],
      },
      { raised: Function.constVoid, renewed: Function.constVoid },
    );
    onTestFinished(async () => {
      await Effect.runPromise(follower.stop());
      await closeHostParts(parts);
    });

    await published(store.database.store, { id: 'e1', type: 'com.acme.closed' });
    const handed = await wokenUntil(
      async () => {
        await Effect.runPromise(follower.wakeUp({ now: Date.now(), sweep: false }));
        return names;
      },
      (found) => found.length >= 2,
    );

    expect(handed.toSorted()).toEqual(['event', 'record']);
  });
});

describe('a start that waited for a later minute', () => {
  it('is a span when it is taken up, linked to the trace of the record that matched its trigger', async () => {
    const time = { now: minute + 1000 };
    const database = await openedOn(await onSQLite());
    const starting = startingOn(
      database,
      () => Effect.void,
      refusalsOn(database, 'workflow', () => time.now),
      () => time.now,
    );
    const recording = recordingTracer();
    await aMinuteOfStartsAndOneMore(starting);

    time.now = minute + aMinute;
    await Effect.runPromise(Effect.withTracer(starting.startDeferred(), recording.tracer));

    expect(recording.spans()).toMatchObject([
      {
        name: 'deferred_start',
        attributes: {
          'auto.on.org': 'acme',
          'auto.on.playbook': 'alpha',
          'auto.on.run_id': 'run-60',
          'auto.on.workflow': 'close',
          'auto.on.trigger.kind': 'event',
        },
        links: [trace],
      },
    ]);
  });

  it('is made after a burst and then silence, by a host whose alarm rings only at a signal or when its wake-up answers it is next due', async () => {
    const alarm = oneAlarmFrom(minute + 1000);
    const store = await openWorkflowStore(await connectedOn({ store: 'sqlite', file: aSQLiteFile() }), []);
    const { through: placeAtOpen } = await store.database.store.readAppended(undefined, 0);
    const { options } = recordedOptionsOf({ sweepEveryMs });
    const reactions = recordedReactions();
    const parts = openHostParts(store, { ...options, clock: alarm.clock }, Function.constVoid);
    const follower = followerWakeUp(
      { database: store.database, parts, reactions: reactions.options, reports: options.reports, placeAtOpen },
      alarm.signal,
    );
    onTestFinished(async () => {
      await Effect.runPromise(follower.stop());
      await closeHostParts(parts);
    });
    await alarm.rung(follower, 1);

    await definitionRecorded(store.database.store, {
      name: 'close',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.closed' })],
    });
    await publishedInTurn(
      store.database.store,
      Array.from({ length: mostStartsAMinute + 1 }, (_, index) => ({ id: `e${index}`, type: 'com.acme.closed' })),
    );
    await alarm.rung(follower, 20);

    expect([reactions.starts().length, alarm.rungAt().filter((rung) => rung >= minute + aMinute)]).toEqual([
      mostStartsAMinute + 1,
      [minute + aMinute],
    ]);
  });
});

describe('a start that waited for a later minute, refused because its workflow’s document cannot be read just now', () => {
  it('is tried each minute past the 20 that drop another, never dropped or said, and starts once the document can be read', async () => {
    const time = { now: minute + 1000 };
    const unread = { now: false };
    const { start, started: startedDeferredStarts } = startedUnlessUnread(unread);
    const database = await openedOn(await onSQLite());
    const refusals = refusalsOn(database, 'workflow', () => time.now);
    const starting = startingOn(database, start, refusals, () => time.now);
    await aMinuteOfStartsAndOneMore(starting);
    unread.now = true;

    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: deliverySweeps + 5 }, (_, index) => index + 1),
        (later) =>
          Effect.suspend(() => {
            time.now = minute + later * aMinute;
            return starting.startDeferred();
          }),
        { discard: true },
      ),
    );
    const kept = await deferredCount(database);
    unread.now = false;
    time.now = minute + (deliverySweeps + 6) * aMinute;
    await Effect.runPromise(starting.startDeferred());
    await Effect.runPromise(refusals.flush());
    const { messages } = await database.store.read(`${playbookKey}reactions/close`);

    expect([kept, await deferredCount(database), startedDeferredStarts().at(-1), messages]).toEqual([
      1,
      0,
      'run-60',
      [],
    ]);
  });
});

describe('the consumers of the reactions of a host', () => {
  it('offer an event to a run listening for it, and note the reason the run gives when it declines the offer', async () => {
    const database = await openedOn(await onSQLite());
    await listening(database);
    const { consumers, offered, notes } = decliningEveryOffer(database);

    const offers = named(consumers, 'listener_offers');
    const batch = await Effect.runPromise(offers.batchOf(followedRecordOf({ ready: true }), undefined, 10));
    await Effect.runPromise(
      Effect.forEach(batch.deliveries, ({ deliver }) => Effect.ignore(deliver), { discard: true }),
    );

    expect(offered).toMatchObject([{ kind: 'event_offered', runId: runKey, key: 'record-1' }]);
    expect(notes).toEqual([
      {
        kind: 'offer_declined',
        run: { org: 'acme', definition: 'alpha', runId },
        detail: 'The run took no event of this kind',
      },
    ]);
  });
});

describe('the refusals of the reactions of a workflow', () => {
  it('are recorded through their decider once a minute ends, one record a trigger and minute, counted, with the last reason, its kind and its because, and the version of the workflow, at the next refusal of that trigger or the next flush', async () => {
    const database = await openedOn(await onSQLite());
    const time = { now: minute + 1000 };
    const refusals = refusalsOn(database, 'workflow', () => time.now);
    const refuse = (refusal: Omit<Refusal, 'definitionKey' | 'workflow' | 'version'>) =>
      Effect.runPromise(refusals.refuse(playbookKey, { ...ofClose, ...refusal }));

    await refuse({ reason: 'first', trigger: onEvent });
    await refuse({ reason: 'second', trigger: daily, kind: 'credits_exhausted', because: 'free_daily_limit' });
    const flushedEarly = await Effect.runPromise(refusals.flush());
    time.now = minute + aMinute + 1000;
    await refuse({ reason: 'third', trigger: daily, kind: 'credits_exhausted', because: 'free_daily_limit' });
    await refuse({ reason: 'fourth' });
    await refuse({ reason: 'fifth' });
    time.now = minute + 2 * aMinute;
    const flushed = await Effect.runPromise(refusals.flush());
    const flushedAgain = await Effect.runPromise(refusals.flush());
    time.now = minute + 3 * aMinute;
    await refuse({ reason: 'sixth', trigger: onEvent, kind: 'meter_unavailable' });
    const { messages } = await database.store.read(reactionsStreamOf(closing, 'workflow'));

    expect([flushedEarly, flushed, flushedAgain]).toEqual([0, 3, 0]);
    expect(messages.map(({ type, data, context }) => ({ type, data, context }))).toEqual([
      {
        type: 'reaction_refused',
        data: { count: 1, reason: 'second', minute: '2026-10-01T09:00:00.000Z', ...ofTheDaily },
        context: { at: '2026-10-01T09:01:01.000Z', ...ofTheWorkflow },
      },
      {
        type: 'reaction_refused',
        data: { count: 1, reason: 'first', minute: '2026-10-01T09:00:00.000Z', trigger: onEvent },
        context: { at: '2026-10-01T09:02:00.000Z', ...ofTheWorkflow },
      },
      {
        type: 'reaction_refused',
        data: { count: 2, reason: 'fifth', minute: '2026-10-01T09:01:00.000Z' },
        context: { at: '2026-10-01T09:02:00.000Z', ...ofTheWorkflow },
      },
      {
        type: 'reaction_refused',
        data: { count: 1, reason: 'third', minute: '2026-10-01T09:01:00.000Z', ...ofTheDaily },
        context: { at: '2026-10-01T09:02:00.000Z', ...ofTheWorkflow },
      },
    ]);
  });
});

describe('the refusals recorded on the stream of a workflow', () => {
  it('are appended after the facts the stream holds, which are not read to learn its version', async () => {
    const measured = readingMeasured(await openedOn(await onSQLite()));
    const time = { now: minute + 1000 };
    const refusals = refusalsOn(measured.database, 'workflow', () => time.now);
    const refusedAt = async (at: number) => {
      time.now = at;
      await Effect.runPromise(refusals.refuse(playbookKey, { ...ofClose, reason: 'r'.repeat(10 * 1024) }));
    };
    await refusedAt(minute + 1000);
    await refusedAt(minute + aMinute + 1000);
    await refusedAt(minute + 2 * aMinute + 1000);
    time.now = minute + 3 * aMinute;
    const readBefore = measured.bytesRead();

    await Effect.runPromise(refusals.flush());
    const readToRecord = measured.bytesRead() - readBefore;
    const { messages } = await measured.database.store.read(reactionsStreamOf(closing, 'workflow'));

    expect([readToRecord, messages.length]).toEqual([0, 3]);
  });
});

describe('the workflow a run began, as the starts of an event trigger learn it', () => {
  it('is the definition the run is filed under, read without a fact of the run or the output of 100 KiB its end holds', async () => {
    const measured = readingMeasured(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
    const stream = `${definitionKeyNamed('close')}runs/r-close`;
    const output = { text: 'x'.repeat(100 * 1024) };
    await recorded(measured.database.store, stream, { type: 'run_started', data: started }, ofTheRun);
    await recorded(measured.database.store, stream, { type: 'run_succeeded', data: { output, record: {} } }, ofTheRun);
    await subscribed(measured.database, 'close', { type: 'go' });
    const readToRecord = measured.bytesRead();

    const { deliveries } = await Effect.runPromise(
      subscriptionStartsOn(measured.database).batchOf(followedRecordOf(null, { topRun: 'r-close' }), undefined, 10),
    );

    expect([deliveries, measured.bytesRead() - readToRecord]).toEqual([[], 0]);
  });
});
