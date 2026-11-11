import { statement } from '@on.auto/ledger';
import { recordingTracer } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { deliverySweeps } from '../follower/consumers.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { StartRefused, type ReactionStart, type StartReaction } from './reaction-options.ts';
import { refusalsOn } from './refusals.ts';
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
  const started: string[] = [];
  return {
    start: (start) =>
      unread.now
        ? Effect.fail(new StartRefused({ detail: 'not read just now', kind: 'content_unavailable' }))
        : Effect.sync(() => {
            started.push(start.runId);
          }),
    started: () => started,
  };
}

async function deferredCount(database: HostDatabase) {
  const [row] = await Effect.runPromise(
    rowsOf(CountRow, database.read(statement`SELECT count(*) AS count FROM workflow_reaction_backlog`)),
  );
  return row?.count;
}

describe('a start that waited for a later minute', () => {
  it('is a span when it is taken up, linked to the trace of the record that matched its trigger', async () => {
    const time = { now: minute + 1000 };
    const database = await openedOn(await onSQLite());
    const starting = startingOn(
      database,
      () => Effect.void,
      refusalsOn(database, () => time.now),
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
});

describe('a start that waited for a later minute, refused because its workflow’s document cannot be read just now', () => {
  it('is tried each minute past the 20 that drop another, never dropped or said, and starts once the document can be read', async () => {
    const time = { now: minute + 1000 };
    const unread = { now: false };
    const { start, started } = startedUnlessUnread(unread);
    const database = await openedOn(await onSQLite());
    const refusals = refusalsOn(database, () => time.now);
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

    expect([kept, await deferredCount(database), started().at(-1), messages]).toEqual([1, 0, 'run-60', []]);
  });
});
