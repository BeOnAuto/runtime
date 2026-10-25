import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { ActedOnRunContextSchema, Conflict, factOf, type Context, type Decider } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { dataAsWritten, emmettEventStore } from './emmett/emmett-event-store.ts';
import { decisionLoop, streamPortsOf, VersionConflict, type DecisionLoop, type Streams } from './index.ts';
import { stamped } from './testing/happenings.ts';
import { outcomeOf } from './testing/open-ledger.ts';
import { tally, type Amounts } from './testing/tally.ts';

interface Loaded {
  readonly state: number;
  readonly version: number;
  readonly loadedFrom: string;
}

interface Appended {
  readonly stream: string;
  readonly events: readonly unknown[];
  readonly expectedVersion: number;
  readonly context?: Context;
}

interface Counted {
  readonly type: 'counted';
  readonly data: { readonly by: number };
}

interface Loop {
  readonly loop: DecisionLoop<Loaded, number, Amounts, Counted, 'conflict'>;
  readonly appended: readonly Appended[];
}

function loopOver(loaded: Loaded, conflicts: number): Loop {
  const appended: Appended[] = [];
  let remaining = conflicts;
  const loop = decisionLoop(
    () => Effect.succeed(loaded),
    (stream, events, { expectedVersion, context }) =>
      Effect.suspend(() => {
        remaining -= 1;
        appended.push({ stream, events, expectedVersion, context });
        return remaining >= 0 ? Effect.fail(new VersionConflict()) : Effect.void;
      }),
    tally,
  );
  return { loop, appended };
}

const snapshotted: Loaded = { state: 40, version: 7, loadedFrom: 'a snapshot and two events' };

describe('the decision loop over any store', () => {
  it('decides on what its load gave, appends with that version expected, and gives the load back with the events', async () => {
    const { loop, appended } = loopOver(snapshotted, 0);

    expect(await Effect.runPromise(loop('run/1', [1, 1]))).toEqual({
      loaded: snapshotted,
      events: [
        { type: 'counted', data: { by: 1 }, context: stamped },
        { type: 'counted', data: { by: 1 }, context: stamped },
      ],
      state: 42,
      version: 9,
    });
    expect(appended).toEqual([
      {
        stream: 'run/1',
        events: [
          { type: 'counted', data: { by: 1 } },
          { type: 'counted', data: { by: 1 } },
        ],
        expectedVersion: 7,
        context: stamped,
      },
    ]);
  });

  it('loads and decides again after a version conflict, and fails with Conflict after three more attempts', async () => {
    const { loop, appended } = loopOver(snapshotted, 4);

    expect(await outcomeOf(loop('run/1', [1]))).toEqual(
      Result.fail(
        new Conflict({ detail: 'The state changed while the command was decided', kind: 'concurrent_change' }),
      ),
    );
    expect(appended).toHaveLength(4);
  });
});

const SignedSchema = factOf('signed', Schema.Struct({ note: Schema.String }), ActedOnRunContextSchema);

type Signed = typeof SignedSchema.Type;

const signatures: Decider<readonly string[], string, Signed> = {
  initialState: [],
  evolve: (signed, { data, context }) => [...signed, `${data.note} by ${context.by} after ${context.runId}`],
  decide: (note) => Result.succeed([{ type: 'signed', data: { note } }]),
  context: (note, signed) => ({ at: '2026-10-05T09:00:00.000Z', by: note, runId: String(signed.length) }),
  eventSchema: SignedSchema,
};

describe('the context of a decision', () => {
  it('is asked of the decider with the command and the loaded state, written with the events and folded with them', async () => {
    const contexts: Context[] = [];
    const loop = decisionLoop(
      () => Effect.succeed({ state: ['earlier by someone after 0'], version: 1 }),
      (_stream, _events, { context }) =>
        Effect.sync(() => {
          contexts.push(context);
        }),
      signatures,
    );

    const { state } = await Effect.runPromise(loop('notes/1', 'later'));

    expect(contexts).toEqual([{ at: '2026-10-05T09:00:00.000Z', by: 'later', runId: '1' }]);
    expect(state).toEqual(['earlier by someone after 0', 'later by later after 1']);
  });

  it('is refused, and nothing appended, when it holds a character no store takes', async () => {
    const appended: unknown[] = [];
    const loop = decisionLoop(
      () => Effect.succeed({ state: [], version: 0 }),
      (_stream, events) =>
        Effect.sync(() => {
          appended.push(events);
        }),
      signatures,
    );

    await expect(outcomeOf(loop('notes/1', 'held\u0000back'))).rejects.toThrow('text without control characters');
    expect(appended).toEqual([]);
  });

  it('is refused, and nothing appended, when it is not the context its fact carries', async () => {
    const appended: unknown[] = [];
    const loop = decisionLoop(
      () => Effect.succeed({ state: [], version: 0 }),
      (_stream, events) =>
        Effect.sync(() => {
          appended.push(events);
        }),
      { ...signatures, context: (note: string) => ({ at: '2026-10-05T09:00:00.000Z', by: note }) },
    );

    await expect(outcomeOf(loop('notes/1', 'unsigned'))).rejects.toThrow('Missing key');
    expect(appended).toEqual([]);
  });
});

async function lentStreams(): Promise<Streams> {
  const emmett = getSQLiteEventStore({
    driver: sqlite3EventStoreDriver,
    fileName: ':memory:',
    schema: { autoMigration: 'None' },
  });
  onTestFinished(() => emmett.close());
  const store = emmettEventStore(emmett, { data: dataAsWritten, mostEventsInOneAppend: 8 });
  await store.migrate();
  return { mostEventsInOneAppend: store.mostEventsInOneAppend, read: store.read, append: store.append };
}

function aheadOnce(streams: Streams): Streams {
  const ahead = { written: false };
  return {
    ...streams,
    append: async (stream, events, place) => {
      if (!ahead.written) {
        ahead.written = true;
        await streams.append(stream, [{ type: 'counted', data: { by: 100 } }], { ...place, context: stamped });
      }
      await streams.append(stream, events, place);
    },
  };
}

function inConflictOnce(streams: Streams): Streams {
  const met = { conflict: false };
  return {
    ...streams,
    append: async (stream, events, place) => {
      if (!met.conflict) {
        met.conflict = true;
        throw new VersionConflict();
      }
      await streams.append(stream, events, place);
    },
  };
}

describe('the stream reader and writer over any streams', () => {
  it('execute a command and load the state it left, as a ledger does, over streams a shell lends', async () => {
    const { load, execute } = streamPortsOf(await lentStreams());

    const executed = await Effect.runPromise(execute('tally/1', tally, [2, 3]));
    const loaded = await Effect.runPromise(load('tally/1', tally));

    expect([executed, loaded]).toEqual([
      { state: 5, version: 2 },
      { state: 5, version: 2 },
    ]);
  });

  it('decide again on the stream another writer appended to meanwhile', async () => {
    const { execute } = streamPortsOf(aheadOnce(await lentStreams()));

    expect(await Effect.runPromise(execute('tally/1', tally, [1]))).toEqual({ state: 101, version: 2 });
  });

  it("decide again when the streams reject an append with the ledger's VersionConflict, as streams a shell lends across a boundary do", async () => {
    const lent = await lentStreams();
    const { execute } = streamPortsOf(inConflictOnce(lent));

    expect(await Effect.runPromise(execute('tally/1', tally, [1]))).toEqual({ state: 1, version: 1 });
    expect((await lent.read('tally/1')).version).toBe(1);
  });
});
